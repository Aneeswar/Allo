# Allo Inventory & Order-Fulfillment Platform

A robust, real-time multi-warehouse inventory and order-fulfillment platform built with **Next.js (App Router)**, **TypeScript**, **Prisma**, **PostgreSQL**, and **Tailwind CSS**. 

This application implements **concurrency-safe stock reservations** during checkout, protecting inventory levels from race conditions when thousands of concurrent shoppers attempt checkout simultaneously.

---

## 🛠 Technology Stack
- **Framework**: Next.js 14+ (App Router, Turbopack)
- **Language**: TypeScript (strict end-to-end typing)
- **Database ORM**: Prisma (v6.x for stable schema-based transaction pooling)
- **Database**: PostgreSQL (Hosted on Supabase / Neon)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Validation**: Zod (for request schemas)
- **Cron Scheduler**: Vercel Cron (for background hold expiry cleanup)
- **Test Runner**: tsx (zero-config TypeScript execution)

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18.x or higher)
- npm

### 2. Environment Setup
Create a `.env` file in the root directory:
```env
# Connect to Supabase/Neon via connection pooling
DATABASE_URL="postgresql://<user>:<password>@<pooler-host>/dbname?pgbouncer=true"

# Direct connection to the database (used by Prisma for schema migrations)
DIRECT_URL="postgresql://<user>:<password>@<direct-host>/dbname"
```

### 3. Installation
Install the project dependencies:
```bash
npm install
```

### 4. Database Schema Setup
Apply the database schema directly to your hosted PostgreSQL database:
```bash
npx prisma db push
```

### 5. Seeding Inventory Data
Populate the database with initial products, warehouses, and stock levels:
```bash
npx prisma db seed
```
This inserts three warehouses (Tokyo, Singapore, US West), three premium products (SoundWave Headphones, Chrono Watch, Aura Desk Lamp), and their respective inventory quantities.

### 6. Running Locally
Start the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application dashboard.

---

## 🔒 Concurrency Correctness (Race-Condition Protection)

The core challenge of this project is ensuring that under high concurrent traffic, available stock is never oversold. 

### Our Solution: PostgreSQL Row-Level Conditional Updates
Instead of relying on heavy application-level distributed locks (e.g. Redis Redlock) which introduce network latency and two-phase commit overhead, we guarantee concurrency safety directly at the database level using a single SQL conditional update inside a Prisma transaction block.

When a client attempts to reserve `N` units of product `P` at warehouse `W`:
1. We run the reservation query:
   ```sql
   UPDATE "Stock"
   SET "reserved" = "reserved" + :quantity
   WHERE "productId" = :productId
     AND "warehouseId" = :warehouseId
     AND ("quantity" - "reserved") >= :quantity
   RETURNING *;
   ```
2. **Serialization**: PostgreSQL serializes updates on the same row. The first request locks the row, updates the `reserved` column, and returns the modified row.
3. **Atomic Evaluation**: The next request evaluates the conditional `WHERE ("quantity" - "reserved") >= :quantity` against the *newly updated* state. If there is no longer enough stock available, the query affects `0` rows and returns an empty array.
4. **Safety Assertion**: If the update returns `0` rows, the API throws an `INSUFFICIENT_STOCK` error, rolls back the transaction, and returns a `409 Conflict` to the client.

### Concurrency Stress Testing
We ship a stress-testing script in `tests/concurrency.ts`. To execute it, run:
```bash
npx tsx tests/concurrency.ts
```
The test:
1. Resets a test SKU to exactly `1` item in stock.
2. Fires `50` simultaneous parallel reservation transactions.
3. Asserts that **exactly 1** request succeeds, **exactly 49** fail with a conflict error, and the database reflects `reserved = 1` and `available = 0`.

---

## ⏳ Reservation Expiry Mechanism

To prevent stock from being locked indefinitely by abandoned checkouts, reservations have an `expiresAt` timestamp (default: 10 minutes). If a reservation is not confirmed, the holds are released.

We employ a **dual cleanup architecture** for maximum reliability:

### 1. Lazy Reclamation (On Writes & Reads)
Whenever a user fetches products (`GET /api/products`) or attempts to create a new reservation (`POST /api/reservations`), we execute a bulk cleanup query first. This guarantees that a customer trying to buy an item will immediately reclaim any expired holds.

**Atomic Bulk Cleanup SQL**:
```sql
WITH expired AS (
  UPDATE "Reservation"
  SET "status" = 'RELEASED', "updatedAt" = NOW()
  WHERE "status" = 'PENDING' AND "expiresAt" < NOW()
  RETURNING "productId", "warehouseId", "quantity"
)
UPDATE "Stock" s
SET "reserved" = GREATEST(0, s."reserved" - sub.total_qty)
FROM (
  SELECT "productId", "warehouseId", SUM("quantity") as total_qty
  FROM expired
  GROUP BY "productId", "warehouseId"
) sub
WHERE s."productId" = sub."productId" AND s."warehouseId" = sub."warehouseId";
```
This CTE executes in a single SQL statement, updating all expired reservation rows to `RELEASED` and decrementing the total reclaimed stock on the `Stock` table in one transaction.

### 2. Scheduled Cron Job (Production Background Worker)
We ship a `vercel.json` file configuring Vercel Cron. In production, Vercel calls the `/api/cron/cleanup` endpoint once per day (compliant with Vercel Hobby tier limits) to proactively purge abandoned holds. This route is secured by verifying the `CRON_SECRET` bearer token injected by Vercel.

---

## 🔂 Idempotency Support (Bonus)

To handle client retries safely without duplicate side effects, we implemented a custom database-backed idempotency wrapper in `src/lib/idempotency.ts` used in the `/api/reservations` and `/api/reservations/:id/confirm` endpoints:

1. **Idempotency Key Verification**: The client sends an `idempotency-key` header in the request.
2. **Initial State Locking**: We attempt to create a record in the `Idempotency` table with `status = 'STARTED'`. If the key is already in the database, the unique constraint throws an error, indicating a retry.
3. **Response Cache Delivery**:
   - If the previous request is still running (`status = 'STARTED'`), we return a `409 Conflict`.
   - If the previous request is complete, we return the cached status code and response payload.
4. **Self-Healing**: If the execution crashes with a `5xx` error, we delete the key to allow client retries.

---

## ⚖️ Trade-offs and Future Improvements

1. **Database Hotspots**: Using single-row updates on the `Stock` table creates a database lock on that row. If a single product SKU is highly popular (e.g. a flash sale), updates on that row will serialize, creating a performance bottleneck. Under extremely high throughput, introducing a distributed cache (like Redis) to queue/buffer reservations or using an event-driven system (like Kafka/RabbitMQ) would scale better.
2. **Authentication**: Authentication was omitted in this client-facing checkout demonstration. In a production environment, warehouse management actions (`GET /api/warehouses`) and fulfillment adjustments should be restricted using standard JWT authentication (e.g., Supabase Auth, NextAuth, or Auth0) with Role-Based Access Control (RBAC).
3. **Distributed Cache for Idempotency**: Storing idempotency payloads in PostgreSQL is reliable and transactional, but adds table bloat. A production system would store these transient payloads (e.g. with a 24-hour TTL) in Redis/Upstash to keep the main SQL database small and fast.
