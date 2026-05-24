import prisma from '@/lib/prisma';

export interface WarehouseStock {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  totalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

export interface ProductWithStock {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  imageUrl: string | null;
  price: number;
  warehouses: WarehouseStock[];
}

export const InventoryService = {
  /**
   * Fetches all products including stock data per warehouse.
   * Computes available stock dynamically.
   */
  async getProductsWithStock(): Promise<ProductWithStock[]> {
    const products = await prisma.product.findMany({
      include: {
        inventories: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return products.map((prod) => ({
      id: prod.id,
      name: prod.name,
      description: prod.description,
      sku: prod.sku,
      imageUrl: prod.imageUrl,
      price: Number(prod.price),
      warehouses: prod.inventories.map((inv) => ({
        warehouseId: inv.warehouse.id,
        warehouseName: inv.warehouse.name,
        warehouseCode: inv.warehouse.code,
        totalQuantity: inv.totalQuantity,
        reservedQuantity: inv.reservedQuantity,
        availableQuantity: Math.max(0, inv.totalQuantity - inv.reservedQuantity),
      })),
    }));
  },

  /**
   * Fetches all warehouses.
   */
  async getWarehouses() {
    return prisma.warehouse.findMany({
      orderBy: {
        code: 'asc',
      },
    });
  },
};
