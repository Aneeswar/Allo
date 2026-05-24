import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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

      // 2. If already released, return success directly (idempotent)
      if (resRecord.status === 'RELEASED') {
        return resRecord;
      }

      // 3. If already confirmed, it cannot be released
      if (resRecord.status === 'CONFIRMED') {
        throw new Error('ALREADY_CONFIRMED');
      }

      // 4. Update the reservation to RELEASED
      const updatedRes = await tx.reservation.update({
        where: { id },
        data: { status: 'RELEASED' },
        include: {
          product: true,
          warehouse: true,
        },
      });

      // 5. Update stock level: decrement reserved count (releasing hold)
      await tx.$executeRaw`
        UPDATE "Stock"
        SET "reserved" = GREATEST(0, "reserved" - ${resRecord.quantity})
        WHERE "productId" = ${resRecord.productId}
          AND "warehouseId" = ${resRecord.warehouseId};
      `;

      return updatedRes;
    });

    return NextResponse.json(reservation, { status: 200 });
  } catch (error) {
    const err = error as Error;
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not Found: Reservation not found' }, { status: 404 });
    }
    if (err.message === 'ALREADY_CONFIRMED') {
      return NextResponse.json(
        { error: 'Bad Request: Cannot release a reservation that has already been confirmed' },
        { status: 400 }
      );
    }

    console.error('Error releasing reservation:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: err.message },
      { status: 500 }
    );
  }
}
