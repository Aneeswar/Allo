import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing data...');
  // Delete in order of dependencies
  await prisma.idempotency.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.stock.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.warehouse.deleteMany({});

  console.log('Seeding warehouses...');
  const wTokyo = await prisma.warehouse.create({
    data: {
      name: 'Tokyo Central',
      location: 'Tokyo, Japan',
    },
  });

  const wSingapore = await prisma.warehouse.create({
    data: {
      name: 'Singapore Hub',
      location: 'Changi, Singapore',
    },
  });

  const wUSWest = await prisma.warehouse.create({
    data: {
      name: 'US West',
      location: 'Oregon, USA',
    },
  });

  console.log('Seeding products...');
  const pHeadphones = await prisma.product.create({
    data: {
      name: 'Allo SoundWave Pro',
      sku: 'SKU-HEAD-001',
      price: 29900, // $299.00
      description: 'Premium over-ear noise-canceling headphones with spatial audio and 40-hour battery life.',
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
    },
  });

  const pWatch = await prisma.product.create({
    data: {
      name: 'Allo Chrono Stealth',
      sku: 'SKU-WAT-002',
      price: 19900, // $199.00
      description: 'Minimalist matte black smartwatch with advanced fitness tracking and a vivid AMOLED screen.',
      imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
    },
  });

  const pLamp = await prisma.product.create({
    data: {
      name: 'Allo Aura Light',
      sku: 'SKU-LMP-003',
      price: 8900, // $89.00
      description: 'Modern architectural ambient desk lamp featuring dynamic color temperature control and touch-sensitive dimming.',
      imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600&auto=format&fit=crop&q=80',
    },
  });

  console.log('Seeding stock levels...');
  // SoundWave Pro Stock
  await prisma.stock.createMany({
    data: [
      { productId: pHeadphones.id, warehouseId: wTokyo.id, quantity: 15, reserved: 0 },
      { productId: pHeadphones.id, warehouseId: wSingapore.id, quantity: 10, reserved: 0 },
      { productId: pHeadphones.id, warehouseId: wUSWest.id, quantity: 5, reserved: 0 },
    ],
  });

  // Chrono Stealth Stock
  await prisma.stock.createMany({
    data: [
      { productId: pWatch.id, warehouseId: wTokyo.id, quantity: 8, reserved: 0 },
      { productId: pWatch.id, warehouseId: wSingapore.id, quantity: 12, reserved: 0 },
      { productId: pWatch.id, warehouseId: wUSWest.id, quantity: 0, reserved: 0 }, // Out of stock in US
    ],
  });

  // Aura Light Stock
  await prisma.stock.createMany({
    data: [
      { productId: pLamp.id, warehouseId: wTokyo.id, quantity: 20, reserved: 0 },
      { productId: pLamp.id, warehouseId: wSingapore.id, quantity: 25, reserved: 0 },
      { productId: pLamp.id, warehouseId: wUSWest.id, quantity: 15, reserved: 0 },
    ],
  });

  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
