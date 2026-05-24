import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleCleanup(req);
}

export async function POST(req: NextRequest) {
  return handleCleanup(req);
}

async function handleCleanup(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  // In production, we protect the cron route using Vercel's injected CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const count = await cleanupExpiredReservations(prisma);
    return NextResponse.json({
      success: true,
      message: 'Successfully processed expired reservations holds.',
      reclaimedCount: count,
    });
  } catch (error) {
    console.error('Error running cron cleanup:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: (error as Error).message },
      { status: 500 }
    );
  }
}
