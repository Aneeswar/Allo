import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Lazily reclaim any expired reservation holds first
    await cleanupExpiredReservations(prisma);

    // Fetch products, including stocks and warehouses
    const products = await prisma.product.findMany({
      include: {
        stocks: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Format the response
    const formattedProducts = products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      imageUrl: product.imageUrl,
      description: product.description,
      stocks: product.stocks.map((stock) => ({
        warehouseId: stock.warehouseId,
        warehouseName: stock.warehouse.name,
        location: stock.warehouse.location,
        quantity: stock.quantity,
        reserved: stock.reserved,
        available: Math.max(0, stock.quantity - stock.reserved),
      })),
    }));

    return NextResponse.json(formattedProducts);
  } catch (error: any) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
