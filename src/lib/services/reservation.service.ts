import prisma from '@/lib/prisma';
import { ReservationStatus } from '@prisma/client';

export const RESERVATION_TTL_MINUTES = 10;

export class ReservationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ReservationError';
  }
}

export const ReservationService = {
  /**
   * Creates a time-bound stock reservation in a warehouse.
   * Uses SELECT FOR UPDATE on the Inventory row to serialize stock checks and reservation allocation.
   */
  async createReservation(productId: string, warehouseId: string, quantity: number) {
    return prisma.$transaction(async (tx) => {
      // 1. Lock the inventory row for update
      const inventories = await tx.$queryRawUnsafe<any[]>(
        `SELECT * FROM "Inventory" WHERE "productId" = $1 AND "warehouseId" = $2 LIMIT 1 FOR UPDATE`,
        productId,
        warehouseId
      );

      if (!inventories || inventories.length === 0) {
        throw new ReservationError(
          'INVENTORY_NOT_FOUND',
          'Inventory record not found for the specified product and warehouse.'
        );
      }

      const inventory = inventories[0];

      // 2. Validate stock availability
      const available = inventory.totalQuantity - inventory.reservedQuantity;
      if (available < quantity) {
        throw new ReservationError(
          'OUT_OF_STOCK',
          `Insufficient stock available. Requested: ${quantity}, Available: ${available}.`
        );
      }

      // 3. Update the reservedQuantity on the inventory row
      await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          reservedQuantity: {
            increment: quantity,
          },
        },
      });

      // 4. Create the pending reservation
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
      const reservation = await tx.reservation.create({
        data: {
          inventoryId: inventory.id,
          quantity,
          status: 'PENDING',
          expiresAt,
        },
        include: {
          inventory: {
            include: {
              product: true,
              warehouse: true,
            },
          },
        },
      });

      return reservation;
    });
  },

  /**
   * Confirms a reservation (payment success scenario).
   * Decrements physical totalQuantity and reservedQuantity, and marks status as CONFIRMED.
   * Performs a lazy cleanup rollback and returns 410 if the reservation has expired.
   */
  async confirmReservation(reservationId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Lock the reservation row
      const reservations = await tx.$queryRawUnsafe<any[]>(
        `SELECT * FROM "Reservation" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
        reservationId
      );

      if (!reservations || reservations.length === 0) {
        throw new ReservationError('RESERVATION_NOT_FOUND', 'Reservation record not found.');
      }

      const reservation = reservations[0];

      // Idempotency: If already confirmed, return success immediately
      if (reservation.status === ReservationStatus.CONFIRMED) {
        return reservation;
      }

      // Validation check
      if (reservation.status !== ReservationStatus.PENDING) {
        throw new ReservationError(
          'INVALID_STATUS',
          `Reservation status is ${reservation.status}, expected PENDING.`
        );
      }

      // 2. Lazy Expiry Check: If past expiresAt, release stock and mark EXPIRED
      const isExpired = new Date(reservation.expiresAt).getTime() < Date.now();
      if (isExpired) {
        // Lock inventory row to update
        await tx.$queryRawUnsafe(
          `SELECT * FROM "Inventory" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
          reservation.inventoryId
        );

        // Release the reserved quantity back
        await tx.inventory.update({
          where: { id: reservation.inventoryId },
          data: {
            reservedQuantity: {
              decrement: reservation.quantity,
            },
          },
        });

        // Set status to EXPIRED
        const updatedReservation = await tx.reservation.update({
          where: { id: reservationId },
          data: { status: ReservationStatus.EXPIRED },
        });

        throw new ReservationError(
          'RESERVATION_EXPIRED',
          'This reservation has expired and the stock hold has been released.'
        );
      }

      // 3. Normal Path: Confirm reservation and decrement physical stock
      // Lock corresponding Inventory row
      await tx.$queryRawUnsafe(
        `SELECT * FROM "Inventory" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
        reservation.inventoryId
      );

      // Decrement both total stock and reserved stock
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          totalQuantity: {
            decrement: reservation.quantity,
          },
          reservedQuantity: {
            decrement: reservation.quantity,
          },
        },
      });

      // Update reservation status to CONFIRMED
      const confirmedReservation = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CONFIRMED },
      });

      return confirmedReservation;
    });
  },

  /**
   * Releases a reservation early (user cancel or payment failure scenario).
   * Decrements reservedQuantity and sets status to RELEASED.
   */
  async releaseReservation(reservationId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Lock the reservation row
      const reservations = await tx.$queryRawUnsafe<any[]>(
        `SELECT * FROM "Reservation" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
        reservationId
      );

      if (!reservations || reservations.length === 0) {
        throw new ReservationError('RESERVATION_NOT_FOUND', 'Reservation record not found.');
      }

      const reservation = reservations[0];

      // Idempotency: If already released, return it
      if (
        reservation.status === ReservationStatus.RELEASED ||
        reservation.status === ReservationStatus.EXPIRED
      ) {
        return reservation;
      }

      if (reservation.status === ReservationStatus.CONFIRMED) {
        throw new ReservationError(
          'ALREADY_CONFIRMED',
          'Cannot release a reservation that has already been confirmed.'
        );
      }

      // 2. Lock and update Inventory row
      await tx.$queryRawUnsafe(
        `SELECT * FROM "Inventory" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
        reservation.inventoryId
      );

      // Decrement reserved quantity
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          reservedQuantity: {
            decrement: reservation.quantity,
          },
        },
      });

      // Mark reservation status as RELEASED
      const updatedReservation = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.RELEASED },
      });

      return updatedReservation;
    });
  },

  /**
   * Cron/Cleanup Worker task to release expired pending reservations.
   * Processes each expiration inside its own database transaction for isolation.
   */
  async cleanupExpiredReservations() {
    console.log('🧹 Executing reservation cleanup worker sweep...');

    // 1. Find all pending expired reservations
    const expiredReservations = await prisma.reservation.findMany({
      where: {
        status: ReservationStatus.PENDING,
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    console.log(`Found ${expiredReservations.length} expired reservations to clean.`);
    let successCount = 0;
    let failCount = 0;

    // 2. Clean up each reservation inside its own transaction
    for (const res of expiredReservations) {
      try {
        await prisma.$transaction(async (tx) => {
          // Lock Reservation row
          const reservations = await tx.$queryRawUnsafe<any[]>(
            `SELECT * FROM "Reservation" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
            res.id
          );

          if (!reservations || reservations.length === 0) return;
          const currentRes = reservations[0];

          // Double check status is still pending (prevent race conditions)
          if (currentRes.status !== ReservationStatus.PENDING) return;

          // Lock corresponding inventory row
          await tx.$queryRawUnsafe(
            `SELECT * FROM "Inventory" WHERE "id" = $1 LIMIT 1 FOR UPDATE`,
            currentRes.inventoryId
          );

          // Decrement reservedQuantity
          await tx.inventory.update({
            where: { id: currentRes.inventoryId },
            data: {
              reservedQuantity: {
                decrement: currentRes.quantity,
              },
            },
          });

          // Set status to EXPIRED
          await tx.reservation.update({
            where: { id: currentRes.id },
            data: {
              status: ReservationStatus.EXPIRED,
            },
          });
        });
        successCount++;
      } catch (err) {
        console.error(`Failed to clean up reservation ${res.id}:`, err);
        failCount++;
      }
    }

    console.log(
      `🧹 Cleanup sweep complete. Successes: ${successCount}, Failures/Skipped: ${failCount}.`
    );
    return { successCount, failCount };
  },
};
