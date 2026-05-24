import { jsonSuccess, jsonError } from '@/lib/api-response';
import { InventoryService } from '@/lib/services/inventory.service';

export async function GET() {
  try {
    const products = await InventoryService.getProductsWithStock();
    return jsonSuccess(products);
  } catch (error: any) {
    console.error('GET /api/products error:', error);
    return jsonError(
      error.message || 'Internal Server Error',
      'INTERNAL_SERVER_ERROR',
      500
    );
  }
}
export const dynamic = 'force-dynamic';
