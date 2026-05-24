import prisma from '../src/lib/prisma';

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Seed Warehouses
  const warehouses = [
    { name: 'East Coast Fulfillment Center', code: 'WH-EAST', location: 'New York, NY' },
    { name: 'West Coast Fulfillment Center', code: 'WH-WEST', location: 'Los Angeles, CA' },
    { name: 'Central Distribution Hub', code: 'WH-CENTRAL', location: 'Chicago, IL' },
  ];

  console.log('Creating warehouses...');
  const seededWarehouses = [];
  for (const wh of warehouses) {
    const record = await prisma.warehouse.upsert({
      where: { code: wh.code },
      update: { name: wh.name, location: wh.location },
      create: wh,
    });
    seededWarehouses.push(record);
    console.log(`  - Warehouse: ${record.name} (${record.code})`);
  }

  // 2. Seed Products
  const products = [
    {
      name: 'Allo Daily Multi-Vitamin',
      description: 'Complete daily nutritional support formulated for maximum absorption.',
      sku: 'ALLO-VIT-001',
      imageUrl: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?auto=format&fit=crop&q=80&w=600',
      price: 19.99,
    },
    {
      name: 'Allo Omega-3 Fish Oil',
      description: 'Premium wild-caught ocean fish oil for heart, brain, and joint health.',
      sku: 'ALLO-OMG-002',
      imageUrl: 'https://images.unsplash.com/photo-1611926653458-09294b3142bf?auto=format&fit=crop&q=80&w=600',
      price: 24.99,
    },
    {
      name: 'Allo Ashwagandha Stress Relief',
      description: 'Clinically proven KSM-66 Ashwagandha to support stress reduction and mental calm.',
      sku: 'ALLO-ASH-003',
      imageUrl: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&q=80&w=600',
      price: 29.99,
    },
    {
      name: 'Allo Probiotics Gut Health',
      description: '50 Billion CFU multi-strain probiotic for optimal digestive and immune wellness.',
      sku: 'ALLO-PRO-004',
      imageUrl: 'https://images.unsplash.com/photo-1550572017-edd951b55104?auto=format&fit=crop&q=80&w=600',
      price: 34.99,
    },
    {
      name: 'Allo Vitamin D3 Boost',
      description: 'High-potency Vitamin D3 to support bone health and immune resilience.',
      sku: 'ALLO-VIT-005',
      imageUrl: 'https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&q=80&w=600',
      price: 14.99,
    },
  ];

  console.log('Creating products...');
  const seededProducts = [];
  for (const prod of products) {
    const record = await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {
        name: prod.name,
        description: prod.description,
        imageUrl: prod.imageUrl,
        price: prod.price,
      },
      create: prod,
    });
    seededProducts.push(record);
    console.log(`  - Product: ${record.name} (${record.sku})`);
  }

  // 3. Seed Inventory Levels (Allocate stock dynamically for testing)
  console.log('Allocating inventory levels across warehouses...');
  const stockAllocations: Record<string, Record<string, number>> = {
    'ALLO-VIT-001': { 'WH-EAST': 50, 'WH-WEST': 30, 'WH-CENTRAL': 10 },
    'ALLO-OMG-002': { 'WH-EAST': 20, 'WH-WEST': 15, 'WH-CENTRAL': 5 },
    'ALLO-ASH-003': { 'WH-EAST': 15, 'WH-WEST': 20, 'WH-CENTRAL': 8 },
    'ALLO-PRO-004': { 'WH-EAST': 8,  'WH-WEST': 10, 'WH-CENTRAL': 2 },
    // Keep Vitamin D3 stock extremely low (1 unit in WH-EAST) to make concurrency testing easy
    'ALLO-VIT-005': { 'WH-EAST': 1,  'WH-WEST': 12, 'WH-CENTRAL': 0 },
  };

  for (const product of seededProducts) {
    const allocations = stockAllocations[product.sku] || {};
    for (const warehouse of seededWarehouses) {
      const stock = allocations[warehouse.code] ?? 0;
      await prisma.inventory.upsert({
        where: {
          productId_warehouseId: {
            productId: product.id,
            warehouseId: warehouse.id,
          },
        },
        update: {
          totalQuantity: stock,
          reservedQuantity: 0, // Reset reservations during seed
        },
        create: {
          productId: product.id,
          warehouseId: warehouse.id,
          totalQuantity: stock,
          reservedQuantity: 0,
        },
      });
    }
  }
  console.log('Inventory allocated.');

  // 4. Apply Database-Level CHECK Constraints manually via raw SQL
  console.log('Applying database-level CHECK constraints for PostgreSQL...');
  try {
    // 4a. Check constraints for reservedQuantity positive
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Inventory" 
      DROP CONSTRAINT IF EXISTS "chk_reserved_qty_positive";
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Inventory" 
      ADD CONSTRAINT "chk_reserved_qty_positive" CHECK ("reservedQuantity" >= 0);
    `);

    // 4b. Check constraints for totalQuantity positive
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Inventory" 
      DROP CONSTRAINT IF EXISTS "chk_total_qty_positive";
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Inventory" 
      ADD CONSTRAINT "chk_total_qty_positive" CHECK ("totalQuantity" >= 0);
    `);

    // 4c. Check constraints for reservedQuantity <= totalQuantity
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Inventory" 
      DROP CONSTRAINT IF EXISTS "chk_reserved_qty_within_limit";
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Inventory" 
      ADD CONSTRAINT "chk_reserved_qty_within_limit" CHECK ("reservedQuantity" <= "totalQuantity");
    `);

    console.log('✅ PostgreSQL CHECK constraints verified and applied successfully.');
  } catch (error) {
    console.warn(
      '⚠️ Could not apply PostgreSQL database CHECK constraints (is the database PostgreSQL?). Error:',
      (error as Error).message
    );
  }

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
