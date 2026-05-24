import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withIdempotency } from '@/lib/idempotency';

type ReservationRow = {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED';
  expiresAt: Date;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Extract id from params
  const { id } = await params;

  return withIdempotency(req, async () => {
    try {
      const reservation = await prisma.$transaction(async (tx) => {
        // 1. Fetch and lock the reservation row pessimisticly
        const reservations = await tx.$queryRaw<ReservationRow[]>`
          SELECT * FROM "Reservation"
          WHERE "id" = ${id}
          FOR UPDATE;
        `;

        const resRecord = reservations?.[0];
        if (!resRecord) {
          throw new Error('NOT_FOUND');
        }

        // 2. If already confirmed, return the record directly (idempotent success)
        if (resRecord.status === 'CONFIRMED') {
          return resRecord;
        }

        const isExpired = new Date(resRecord.expiresAt) < new Date();

        // 3. If already released or expired, mark as released if pending and return 410
        if (resRecord.status === 'RELEASED' || isExpired) {
          if (resRecord.status === 'PENDING') {
            // Lazy release this specific reservation to return stock to available pool
            await tx.reservation.update({
              where: { id },
              data: { status: 'RELEASED' },
            });

            // Decrement Stock.reserved count
            await tx.$executeRaw`
              UPDATE "Stock"
              SET "reserved" = GREATEST(0, "reserved" - ${resRecord.quantity})
              WHERE "productId" = ${resRecord.productId}
                AND "warehouseId" = ${resRecord.warehouseId};
            `;
          }
          throw new Error('EXPIRED');
        }

        // 4. Update the reservation to CONFIRMED
        const updatedRes = await tx.reservation.update({
          where: { id },
          data: { status: 'CONFIRMED' },
          include: {
            product: true,
            warehouse: true,
          },
        });

        // 5. Update physical stock levels: decrement quantity (physical) and decrement reserved
        await tx.$executeRaw`
          UPDATE "Stock"
          SET "quantity" = GREATEST(0, "quantity" - ${resRecord.quantity}),
              "reserved" = GREATEST(0, "reserved" - ${resRecord.quantity})
          WHERE "productId" = ${resRecord.productId}
            AND "warehouseId" = ${resRecord.warehouseId};
        `;

        return updatedRes;
      });

      return NextResponse.json(reservation, { status: 200 });
    } catch (error: any) {
      if (error.message === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Not Found: Reservation not found' }, { status: 404 });
      }
      if (error.message === 'EXPIRED') {
        return NextResponse.json(
          { error: 'Gone: The reservation has expired and cannot be confirmed' },
          { status: 410 }
        );
      }

      console.error('Error confirming reservation:', error);
      return NextResponse.json(
        { error: 'Internal Server Error', details: error.message },
        { status: 500 }
      );
    }
  });
}
