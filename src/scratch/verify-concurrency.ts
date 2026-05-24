import prisma from '../lib/prisma';
import { ReservationService, ReservationError } from '../lib/services/reservation.service';

async function verifyConcurrency() {
  console.log('🚀 Starting Concurrency Verification Test...');

  // 1. Fetch target product (ALLO-VIT-005 has 1 stock allocated in WH-EAST)
  const product = await prisma.product.findUnique({
    where: { sku: 'ALLO-VIT-005' },
  });
  const warehouse = await prisma.warehouse.findUnique({
    where: { code: 'WH-EAST' },
  });

  if (!product || !warehouse) {
    console.error('❌ Error: Seed data not found. Please run database seeding first.');
    process.exit(1);
  }

  // 2. Fetch inventory row
  const inventoryBefore = await prisma.inventory.findUnique({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id,
      },
    },
  });

  if (!inventoryBefore) {
    console.error('❌ Error: Inventory record not found.');
    process.exit(1);
  }

  console.log('\n📊 INVENTORY BEFORE CONCURRENCY TEST:');
  console.log(`  Total Quantity:     ${inventoryBefore.totalQuantity}`);
  console.log(`  Reserved Quantity:  ${inventoryBefore.reservedQuantity}`);
  console.log(`  Available Stock:    ${inventoryBefore.totalQuantity - inventoryBefore.reservedQuantity}`);
  console.log('  --------------------------------------------------');

  // Enforce exactly 1 available stock for testing
  if (inventoryBefore.totalQuantity - inventoryBefore.reservedQuantity !== 1) {
    console.log('⚠️ Adjusting stock to exactly 1 total, 0 reserved for verification consistency...');
    await prisma.inventory.update({
      where: { id: inventoryBefore.id },
      data: { totalQuantity: 1, reservedQuantity: 0 },
    });
  }

  console.log('\n🔥 Dispatching 10 simultaneous reservations for 1 unit...');

  const concurrentRequests = 10;
  const promises = Array.from({ length: concurrentRequests }).map((_, index) => {
    return ReservationService.createReservation(product.id, warehouse.id, 1)
      .then((res) => {
        return { success: true as const, index, data: res };
      })
      .catch((err) => {
        return { success: false as const, index, error: err };
      });
  });

  // Dispatches promises concurrently at database level
  const results = await Promise.all(promises);

  console.log('\n📥 CONCURRENT TRANSACTIONS LOGS:');
  
  let successCount = 0;
  let failureCount = 0;
  let outOfStockCount = 0;
  let otherErrorCount = 0;

  results.forEach((res) => {
    if (res.success) {
      successCount++;
      console.log(`  [Request #${res.index}] ✅ SUCCESS - Created Reservation: ${res.data.id}`);
    } else {
      failureCount++;
      const isOOS = res.error instanceof ReservationError && res.error.code === 'OUT_OF_STOCK';
      if (isOOS) {
        outOfStockCount++;
        console.log(`  [Request #${res.index}] ❌ REJECTED - Code: OUT_OF_STOCK (Error: ${res.error.message})`);
      } else {
        otherErrorCount++;
        console.log(`  [Request #${res.index}] ❌ REJECTED - Error: ${res.error.message}`);
      }
    }
  });

  // 3. Fetch final inventory row
  const inventoryAfter = await prisma.inventory.findUnique({
    where: { id: inventoryBefore.id },
  });

  console.log('\n📊 INVENTORY AFTER CONCURRENCY TEST:');
  console.log(`  Total Quantity:     ${inventoryAfter!.totalQuantity}`);
  console.log(`  Reserved Quantity:  ${inventoryAfter!.reservedQuantity}`);
  console.log(`  Available Stock:    ${inventoryAfter!.totalQuantity - inventoryAfter!.reservedQuantity}`);
  console.log('  --------------------------------------------------');

  console.log('\n📝 ASSERTION RESULTS:');
  console.log(`  Expected Successes: 1 | Actual: ${successCount}`);
  console.log(`  Expected Failures:  9 | Actual: ${failureCount} (Out-of-Stock errors: ${outOfStockCount})`);

  const assertionSuccess = successCount === 1;
  const assertionFails = outOfStockCount === concurrentRequests - 1;
  const assertionInventory = inventoryAfter!.reservedQuantity === 1;

  if (assertionSuccess && assertionFails && assertionInventory) {
    console.log('\n🎉 ASSERTION: PASSED! Concurrency safety is fully guaranteed.');
  } else {
    console.error('\n❌ ASSERTION: FAILED! Concurrent double-selling detected.');
  }
}

verifyConcurrency()
  .catch((err) => {
    console.error('Unhandled script error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
