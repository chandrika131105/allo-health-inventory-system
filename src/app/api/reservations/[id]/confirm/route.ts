import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/lib/api-response';
import { idempotency } from '@/lib/redis';
import { ReservationService, ReservationError } from '@/lib/services/reservation.service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const idempotencyKey = request.headers.get('Idempotency-Key');

  // 1. Idempotency Check
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
        return jsonSuccess(parsed.data, parsed.status || 200);
      } catch (err) {
        console.error('Failed to parse cached response:', err);
      }
    }

    const locked = await idempotency.setInProgress(idempotencyKey);
    if (!locked) {
      return jsonError(
        'A request with this idempotency key is already in progress.',
        'IDEMPOTENCY_IN_PROGRESS',
        409
      );
    }
  }

  try {
    // 2. Perform database updates
    const confirmed = await ReservationService.confirmReservation(id);

    // 3. Cache response
    if (idempotencyKey) {
      await idempotency.setCompleted(idempotencyKey, {
        status: 200,
        data: confirmed,
      });
    }

    return jsonSuccess(confirmed, 200);
  } catch (error: any) {
    console.error('Reservation confirmation error:', error);

    if (error instanceof ReservationError) {
      // Clean up idempotency key on path validation errors so client can fix and retry
      if (idempotencyKey) {
        if (error.code === 'RESERVATION_EXPIRED') {
          // If it expired, we cache the 410 response so subsequent retries get 410 immediately
          const errorData = {
            success: false,
            error: { code: 'RESERVATION_EXPIRED', message: error.message },
          };
          await idempotency.setCompleted(idempotencyKey, {
            status: 410,
            data: errorData,
          });
        } else {
          await idempotency.delete(idempotencyKey);
        }
      }

      if (error.code === 'RESERVATION_EXPIRED') {
        return jsonError(error.message, 'RESERVATION_EXPIRED', 410);
      }
      if (error.code === 'RESERVATION_NOT_FOUND') {
        return jsonError(error.message, 'RESERVATION_NOT_FOUND', 404);
      }
      if (error.code === 'INVALID_STATUS') {
        return jsonError(error.message, 'INVALID_STATUS', 400);
      }
    }

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
