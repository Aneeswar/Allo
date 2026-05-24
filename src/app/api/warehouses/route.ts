import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const warehouses = await prisma.warehouse.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json(warehouses);
  } catch (error: any) {
    console.error('Error fetching warehouses:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
