import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/lib/api-response';
import { idempotency } from '@/lib/redis';
import { createReservationSchema } from '@/lib/validations/reservation.schema';
import { ReservationService, ReservationError } from '@/lib/services/reservation.service';

export async function POST(request: NextRequest) {
  const idempotencyKey = request.headers.get('Idempotency-Key');

  // 1. Idempotency Check (Redis Guard)
  if (idempotencyKey) {
    const cachedResponse = await idempotency.get(idempotencyKey);
    if (cachedResponse) {
      if (cachedResponse === 'IN_PROGRESS') {
        return jsonError(
          'A request with this idempotency key is already in progress.',
          'IDEMPOTENCY_IN_PROGRESS',
          409
        );
      }
      try {
        const parsed = JSON.parse(cachedResponse);
        return jsonSuccess(parsed.data, parsed.status || 201);
      } catch (err) {
        console.error('Failed to parse cached response:', err);
      }
    }

    // Attempt to acquire lock for this key
    const locked = await idempotency.setInProgress(idempotencyKey);
    if (!locked) {
      return jsonError(
        'A request with this idempotency key is already in progress.',
        'IDEMPOTENCY_IN_PROGRESS',
        409
      );
    }
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    if (idempotencyKey) await idempotency.delete(idempotencyKey);
    return jsonError('Invalid JSON request body.', 'BAD_REQUEST', 400);
  }

  // 2. Schema Validation
  const validated = createReservationSchema.safeParse(body);
  if (!validated.success) {
    if (idempotencyKey) await idempotency.delete(idempotencyKey);
    const errorDetails = validated.error.flatten().fieldErrors;
    return jsonError(
      'Validation failed.',
      'VALIDATION_ERROR',
      400
    );
  }

  const { productId, warehouseId, quantity } = validated.data;

  try {
    // 3. Perform the database transaction with SELECT FOR UPDATE row-locking
    const reservation = await ReservationService.createReservation(
      productId,
      warehouseId,
      quantity
    );

    const successData = {
      id: reservation.id,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      product: {
        id: reservation.inventory.product.id,
        name: reservation.inventory.product.name,
        sku: reservation.inventory.product.sku,
        price: Number(reservation.inventory.product.price),
      },
      warehouse: {
        id: reservation.inventory.warehouse.id,
        name: reservation.inventory.warehouse.name,
        code: reservation.inventory.warehouse.code,
      },
    };

    // 4. Cache successful response in Redis
    if (idempotencyKey) {
      await idempotency.setCompleted(idempotencyKey, {
        status: 201,
        data: successData,
      });
    }

    return jsonSuccess(successData, 201);
  } catch (error: any) {
    console.error('Reservation creation error:', error);

    if (error instanceof ReservationError) {
      // For out of stock, we can cache the 409 error response to avoid repeated DB strain
      if (error.code === 'OUT_OF_STOCK') {
        const errorData = {
          success: false,
          error: { code: 'OUT_OF_STOCK', message: error.message },
        };
        if (idempotencyKey) {
          await idempotency.setCompleted(idempotencyKey, {
            status: 409,
            data: errorData,
          });
        }
        return jsonError(error.message, 'OUT_OF_STOCK', 409);
      }

      if (error.code === 'INVENTORY_NOT_FOUND') {
        if (idempotencyKey) await idempotency.delete(idempotencyKey);
        return jsonError(error.message, 'INVENTORY_NOT_FOUND', 404);
      }
    }

    // For database deadlocks, connection drops or other transient errors,
    // delete the idempotency key so the client can retry the request.
    if (idempotencyKey) {
      await idempotency.delete(idempotencyKey);
    }

    return jsonError(
      error.message || 'Internal Server Error',
      'INTERNAL_SERVER_ERROR',
      500
    );
  }
}
