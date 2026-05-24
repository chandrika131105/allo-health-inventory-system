import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/lib/api-response';
import { ReservationService, ReservationError } from '@/lib/services/reservation.service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const released = await ReservationService.releaseReservation(id);
    return jsonSuccess(released, 200);
  } catch (error: any) {
    console.error('Reservation release error:', error);

    if (error instanceof ReservationError) {
      if (error.code === 'RESERVATION_NOT_FOUND') {
        return jsonError(error.message, 'RESERVATION_NOT_FOUND', 404);
      }
      if (
        error.code === 'ALREADY_CONFIRMED' ||
        error.code === 'INVALID_STATUS'
      ) {
        return jsonError(error.message, 'BAD_REQUEST', 400);
      }
    }

    return jsonError(
      error.message || 'Internal Server Error',
      'INTERNAL_SERVER_ERROR',
      500
    );
  }
}
