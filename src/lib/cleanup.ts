import { prisma } from './db';
import { Prisma } from '@prisma/client';

/**
 * Periodically or lazily cleans up expired reservations.
 * Updates expired PENDING reservations to RELEASED,
 * and decrements the reserved count on the Stock table by the reclaimed amounts.
 * 
 * Runs atomically in a single SQL operation.
 */
export async function cleanupExpiredReservations(
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<number> {
  const result = await client.$executeRaw`
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
  `;
  return result;
}
