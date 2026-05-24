import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/cleanup';
import { withIdempotency } from '@/lib/idempotency';
import { z } from 'zod';

const reserveSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  warehouseId: z.string().min(1, 'Warehouse ID is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  expiresInMinutes: z.number().int().positive().optional(),
});

type StockRow = {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reserved: number;
};

export async function POST(req: NextRequest) {
  return withIdempotency(req, async () => {
    try {
      const body = await req.json();
      const parsed = reserveSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid request body', details: parsed.error.format() },
          { status: 400 }
        );
      }

      const { productId, warehouseId, quantity, expiresInMinutes = 10 } = parsed.data;

      // Execute stock reservation inside a database transaction to ensure atomicity
      const reservation = await prisma.$transaction(async (tx) => {
        // 1. Reclaim any expired reservations first to free up stock
        await cleanupExpiredReservations(tx);

        // 2. Perform the concurrency-safe atomic update
        // This query locks the Stock row and ONLY succeeds if available stock >= quantity
        const updatedStocks = await tx.$queryRaw<StockRow[]>`
          UPDATE "Stock"
          SET "reserved" = "reserved" + ${quantity}
          WHERE "productId" = ${productId}
            AND "warehouseId" = ${warehouseId}
            AND ("quantity" - "reserved") >= ${quantity}
          RETURNING *;
        `;

        if (!updatedStocks || updatedStocks.length === 0) {
          // If no rows were updated, it means stock is insufficient
          throw new Error('INSUFFICIENT_STOCK');
        }

        // 3. Create the Reservation record
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
        const resRecord = await tx.reservation.create({
          data: {
            productId,
            warehouseId,
            quantity,
            status: 'PENDING',
            expiresAt,
          },
          include: {
            product: true,
            warehouse: true,
          },
        });

        return resRecord;
      });

      return NextResponse.json(reservation, { status: 201 });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'INSUFFICIENT_STOCK') {
        return NextResponse.json(
          { error: 'Conflict: Not enough stock available in this warehouse' },
          { status: 409 }
        );
      }

      console.error('Error reserving stock:', error);
      return NextResponse.json(
        { error: 'Internal Server Error', details: err.message },
        { status: 500 }
      );
    }
  });
}
