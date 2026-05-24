import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/lib/api-response';
import { ReservationService } from '@/lib/services/reservation.service';

export async function GET(request: NextRequest) {
  return handleCleanup(request);
}

export async function POST(request: NextRequest) {
  return handleCleanup(request);
}

async function handleCleanup(request: NextRequest) {
  // Simple check for Vercel Cron authorization header in production
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production' && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return jsonError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  try {
    const results = await ReservationService.cleanupExpiredReservations();
    return jsonSuccess(results);
  } catch (error: any) {
    console.error('Cron cleanup error:', error);
    return jsonError(
      error.message || 'Internal Server Error',
      'INTERNAL_SERVER_ERROR',
      500
    );
  }
}
export const dynamic = 'force-dynamic';
