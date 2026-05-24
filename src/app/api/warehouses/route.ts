import { jsonSuccess, jsonError } from '@/lib/api-response';
import { InventoryService } from '@/lib/services/inventory.service';

export async function GET() {
  try {
    const warehouses = await InventoryService.getWarehouses();
    return jsonSuccess(warehouses);
  } catch (error: any) {
    console.error('GET /api/warehouses error:', error);
    return jsonError(
      error.message || 'Internal Server Error',
      'INTERNAL_SERVER_ERROR',
      500
    );
  }
}
export const dynamic = 'force-dynamic';
