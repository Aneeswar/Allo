import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './db';

/**
 * Executes an API handler with idempotency protection.
 * If the client supplies an 'idempotency-key' header, the response is cached.
 * Subsequent requests with the same key will receive the cached response.
 */
export async function withIdempotency(
  req: NextRequest,
  handler: (key: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get('idempotency-key');
  if (!key || key.trim() === '') {
    // If no key is provided, execute the handler directly
    return handler('');
  }

  // Check/create idempotency record
  try {
    // This will fail if the key already exists (unique primary key constraint)
    await prisma.idempotency.create({
      data: {
        key,
        status: 'STARTED',
      },
    });
  } catch {
    // Record already exists
    const record = await prisma.idempotency.findUnique({
      where: { key },
    });

    if (!record) {
      return NextResponse.json({ error: 'Idempotency lookup failed' }, { status: 500 });
    }

    if (record.status === 'STARTED') {
      // The request is still in progress
      return NextResponse.json(
        { error: 'Conflict: Request already in progress' },
        { status: 409 }
      );
    }

    // Return the cached response
    return new NextResponse(record.responseBody, {
      status: record.responseCode || 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache-Lookup': 'HIT - Idempotency',
      },
    });
  }

  // Execute handler and capture response
  try {
    const response = await handler(key);
    
    // We only cache non-5xx responses. If it's a server error (500+), we let them retry.
    if (response.status < 500) {
      const clonedResponse = response.clone();
      const bodyText = await clonedResponse.text();
      
      await prisma.idempotency.update({
        where: { key },
        data: {
          status: 'COMPLETED',
          responseCode: response.status,
          responseBody: bodyText,
        },
      });
    } else {
      // Remove the idempotency key so the client can retry
      await prisma.idempotency.delete({
        where: { key },
      }).catch(() => {});
    }

    return response;
  } catch {
    // On unexpected error, clean up the idempotency record so they can retry
    await prisma.idempotency.delete({
      where: { key },
    }).catch(() => {});
    
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
