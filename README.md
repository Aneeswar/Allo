# Allo Inventory & Order-Fulfillment Platform

An inventory and order-fulfillment platform built with **Next.js (App Router)**, **TypeScript**, **Prisma**, **Tailwind CSS**, and **PostgreSQL** that implements race-condition-free stock reservations during checkout.

## Features
- **Multi-Warehouse Stock Management**: Tracking inventory across multiple warehouses per SKU.
- **Race-Condition-Free Reservations**: Ensuring unit holds are safe under high concurrent traffic.
- **Auto-Expiry Cleanup**: Automatically releasing holds that are not confirmed within the checkout window.
- **Idempotent APIs**: Safe retries using client-supplied headers for reservation and confirmation.

## Tech Stack
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database ORM**: Prisma
- **Database**: PostgreSQL (Supabase/Neon)
- **Styling**: Tailwind CSS

## Getting Started

### 1. Prerequisites
- Node.js (v18.x or higher)
- npm

### 2. Environment Setup
Create a `.env` file in the root of the project with your PostgreSQL connection strings:
```env
DATABASE_URL="postgresql://<user>:<password>@<host>/dbname?sslmode=require"
DIRECT_URL="postgresql://<user>:<password>@<host>/dbname?sslmode=require"
```

### 3. Installation
Install the project dependencies:
```bash
npm install
```

### 4. Database Setup
Push the database schema and seed the initial inventory data:
```bash
# Push schema to PostgreSQL
npx prisma db push

# Seed products, warehouses, and stock levels
npx prisma db seed
```

### 5. Running the Application
Run the local development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.
