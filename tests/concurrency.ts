import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runConcurrencyTest() {
  console.log('=== STARTING CONCURRENCY STRESS TEST ===');
  
  // 1. Setup/clean test data
  console.log('Setting up test product and warehouse...');
  
  // Create or find a test warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { id: 'test-concurrency-warehouse' },
    update: {},
    create: {
      id: 'test-concurrency-warehouse',
      name: 'Concurrency Test Warehouse',
      location: 'Test Lab',
    },
  });

  // Create or find a test product
  const product = await prisma.product.upsert({
    where: { sku: 'SKU-TEST-LOCK' },
    update: {},
    create: {
      name: 'Concurrency Test Item',
      sku: 'SKU-TEST-LOCK',
      price: 1000, // $10.00
      description: 'Used for concurrency stress testing.',
    },
  });

  // Reset reservation logs for this product
  await prisma.reservation.deleteMany({
    where: {
      productId: product.id,
      warehouseId: warehouse.id,
    },
  });

  // Seed stock level to exactly 1 unit (0 reserved)
  await prisma.stock.upsert({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id,
      },
    },
    update: {
      quantity: 1,
      reserved: 0,
    },
    create: {
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: 1,
      reserved: 0,
    },
  });

  console.log('Database initialized: Product SKU-TEST-LOCK set to exactly 1 unit in stock.');

  // 2. Define the reservation transaction logic
  const attemptReservation = async (index: number) => {
    return prisma.$transaction(async (tx) => {
      // Run the atomic update query
      const updatedStocks = await tx.$queryRaw<unknown[]>`
        UPDATE "Stock"
        SET "reserved" = "reserved" + 1
        WHERE "productId" = ${product.id}
          AND "warehouseId" = ${warehouse.id}
          AND ("quantity" - "reserved") >= 1
        RETURNING *;
      `;

      if (!updatedStocks || updatedStocks.length === 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      // Create reservation record
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const reservation = await tx.reservation.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 1,
          status: 'PENDING',
          expiresAt,
        },
      });

      return { index, reservationId: reservation.id };
    });
  };

  // 3. Fire 50 concurrent requests simultaneously
  const CONCURRENT_REQUESTS = 50;
  console.log(`Firing ${CONCURRENT_REQUESTS} concurrent reservation requests...`);

  const promises = Array.from({ length: CONCURRENT_REQUESTS }).map((_, i) => attemptReservation(i));
  const results = await Promise.allSettled(promises);

  // 4. Analyze results
  let succeeded = 0;
  let failed = 0;
  const errors: Record<string, number> = {};

  results.forEach((res) => {
    if (res.status === 'fulfilled') {
      succeeded++;
    } else {
      failed++;
      const errMsg = res.reason?.message || 'Unknown error';
      errors[errMsg] = (errors[errMsg] || 0) + 1;
    }
  });

  console.log('\n=== RESULTS ANALYSIS ===');
  console.log(`Total Requests: ${CONCURRENT_REQUESTS}`);
  console.log(`Succeeded (Stock Reserved): ${succeeded}`);
  console.log(`Failed (Rejected): ${failed}`);
  console.log('Rejection Reasons:', errors);

  // 5. Query final state of stock
  const finalStock = await prisma.stock.findUnique({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id,
      },
    },
  });

  console.log('\n=== FINAL DATABASE STATE ===');
  console.log(`Stock Level -> Quantity (Physical): ${finalStock?.quantity}`);
  console.log(`Stock Level -> Reserved: ${finalStock?.reserved}`);
  console.log(`Stock Level -> Available (Qty - Reserved): ${(finalStock?.quantity || 0) - (finalStock?.reserved || 0)}`);

  // Assertions for verification
  console.log('\n=== VERIFICATION ASSERIONS ===');
  let testsPassed = true;

  if (succeeded === 1) {
    console.log('✓ PASS: Exactly 1 reservation succeeded.');
  } else {
    console.error(`✗ FAIL: Expected exactly 1 reservation to succeed, but got ${succeeded}.`);
    testsPassed = false;
  }

  if (failed === CONCURRENT_REQUESTS - 1) {
    console.log(`✓ PASS: Exactly ${CONCURRENT_REQUESTS - 1} reservations were rejected.`);
  } else {
    console.error(`✗ FAIL: Expected exactly ${CONCURRENT_REQUESTS - 1} rejections, but got ${failed}.`);
    testsPassed = false;
  }

  if (finalStock?.reserved === 1) {
    console.log('✓ PASS: Stock reserved count is exactly 1.');
  } else {
    console.error(`✗ FAIL: Expected Stock reserved count to be 1, but got ${finalStock?.reserved}.`);
    testsPassed = false;
  }

  if (testsPassed) {
    console.log('\n🏆 ALL CONCURRENCY CHECKS PASSED SUCCESSFULLY!');
  } else {
    console.error('\n🚨 CONCURRENCY CHECKS FAILED!');
    process.exit(1);
  }
}

runConcurrencyTest()
  .catch((e) => {
    console.error('Test run crashed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
