'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { ProductWithStock } from '@/lib/services/inventory.service';
import { ShoppingBag, Loader2, RefreshCw, Warehouse as WarehouseIcon } from 'lucide-react';

interface ProductListingProps {
  initialProducts: ProductWithStock[];
}

export default function ProductListing({ initialProducts }: ProductListingProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductWithStock[]>(initialProducts);
  const [selectedWarehouses, setSelectedWarehouses] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isReserving, setIsReserving] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const handleImageError = (productId: string) => {
    setFailedImages((prev) => ({ ...prev, [productId]: true }));
  };

  // Helper to fetch latest stock levels
  const refreshStock = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/products');
      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
        toast('Stock levels refreshed successfully.', 'success');
      } else {
        toast('Failed to refresh stock.', 'error');
      }
    } catch (err) {
      toast('Failed to reach the server to refresh stock.', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const getSelectedWarehouseId = (productId: string, product: ProductWithStock) => {
    return selectedWarehouses[productId] || product.warehouses[0]?.warehouseId || '';
  };

  const getQuantity = (productId: string) => {
    return quantities[productId] || 1;
  };

  const handleWarehouseChange = (productId: string, warehouseId: string) => {
    setSelectedWarehouses((prev) => ({ ...prev, [productId]: warehouseId }));
  };

  const handleQuantityChange = (productId: string, quantity: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: quantity }));
  };

  const handleReserve = async (product: ProductWithStock) => {
    const productId = product.id;
    const warehouseId = getSelectedWarehouseId(productId, product);
    const quantity = getQuantity(productId);

    if (!warehouseId) {
      toast('Please select a warehouse.', 'warning');
      return;
    }

    const warehouse = product.warehouses.find((w) => w.warehouseId === warehouseId);
    if (!warehouse) return;

    if (warehouse.availableQuantity < quantity) {
      toast('Requested quantity exceeds available stock.', 'error', 'Insufficient Stock');
      return;
    }

    // Set loading state
    setIsReserving((prev) => ({ ...prev, [productId]: true }));

    // Optimistic UI Update: Decrement local stock temporarily
    const previousProductsState = [...products];
    setProducts((prevProducts) =>
      prevProducts.map((p) => {
        if (p.id !== productId) return p;
        return {
          ...p,
          warehouses: p.warehouses.map((w) => {
            if (w.warehouseId !== warehouseId) return w;
            return {
              ...w,
              reservedQuantity: w.reservedQuantity + quantity,
              availableQuantity: Math.max(0, w.availableQuantity - quantity),
            };
          }),
        };
      })
    );

    // Create unique Idempotency Key
    const idempotencyKey = `idemp-reserve-${productId}-${warehouseId}-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ productId, warehouseId, quantity }),
      });

      const resJson = await response.json();

      if (response.status === 201 && resJson.success) {
        toast(`Hold created for ${quantity} unit(s). Redirecting to checkout...`, 'success', 'Stock Reserved');
        // Route to checkout screen
        router.push(`/checkout/${resJson.data.id}`);
      } else {
        // Rollback optimistic update on error
        setProducts(previousProductsState);
        
        const errMsg = resJson.error?.message || 'Failed to create reservation.';
        const errCode = resJson.error?.code || 'UNKNOWN_ERROR';

        if (response.status === 409) {
          toast(
            'The last unit was just reserved by another customer. Concurrency lock enforced.',
            'error',
            'Conflict (409)'
          );
        } else {
          toast(errMsg, 'error', `Error (${errCode})`);
        }
      }
    } catch (err) {
      setProducts(previousProductsState);
      toast('Network error occurred. Please try again.', 'error', 'Connection Error');
    } finally {
      setIsReserving((prev) => ({ ...prev, [productId]: false }));
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Health Catalog</h2>
          <p className="text-sm text-slate-500">
            Real-time multi-warehouse inventory levels with transaction-safe locks.
          </p>
        </div>
        <button
          onClick={refreshStock}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-200 text-slate-700 bg-white rounded-xl shadow-xs hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh Stock'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => {
          const selectedWhId = getSelectedWarehouseId(product.id, product);
          const currentWh = product.warehouses.find((w) => w.warehouseId === selectedWhId);
          const availableStock = currentWh ? currentWh.availableQuantity : 0;
          const qty = getQuantity(product.id);
          const loading = isReserving[product.id] || false;

          return (
            <div
              key={product.id}
              className="glow-card flex flex-col bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-xs relative"
            >
              {/* Product Image */}
              <div className="h-48 w-full bg-slate-100 relative overflow-hidden flex-shrink-0">
                {product.imageUrl && !failedImages[product.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    onError={() => handleImageError(product.id)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-teal-500/20 to-emerald-600/30 text-teal-900 dark:text-teal-200 font-bold select-none p-4 text-center">
                    <div className="text-2xl tracking-wider font-mono font-extrabold">
                      {product.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 3)
                        .join('')
                        .toUpperCase()}
                    </div>
                    <ShoppingBag className="w-4 h-4 mt-2 opacity-50" />
                  </div>
                )}
                <div className="absolute top-3 right-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs px-2.5 py-1 rounded-lg text-sm font-bold text-teal-700 dark:text-teal-400 border border-slate-100 shadow-xs">
                  ${product.price.toFixed(2)}
                </div>
              </div>

              {/* Product Info */}
              <div className="p-6 flex-1 flex flex-col">
                <div className="mb-4">
                  <h3 className="font-bold text-lg text-slate-900 leading-snug line-clamp-1">
                    {product.name}
                  </h3>
                  <p className="text-xs font-mono text-slate-400 mt-0.5">SKU: {product.sku}</p>
                  <p className="text-sm text-slate-500 mt-2 line-clamp-2 min-h-[40px]">
                    {product.description || 'No description provided.'}
                  </p>
                </div>

                {/* Warehouse Selector */}
                <div className="space-y-3 mt-auto pt-4 border-t border-slate-50">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Select Warehouse
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {product.warehouses.map((wh) => (
                      <label
                        key={wh.warehouseId}
                        className={`flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                          selectedWhId === wh.warehouseId
                            ? 'bg-teal-50/50 border-teal-200 text-teal-900 font-medium'
                            : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`warehouse-${product.id}`}
                            checked={selectedWhId === wh.warehouseId}
                            onChange={() => handleWarehouseChange(product.id, wh.warehouseId)}
                            className="text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                          />
                          <div className="flex flex-col">
                            <span>{wh.warehouseName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Code: {wh.warehouseCode}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {wh.availableQuantity} available
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Total: {wh.totalQuantity} | Hold: {wh.reservedQuantity}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Action Row */}
                <div className="grid grid-cols-4 gap-2 mt-5">
                  {/* Quantity Selector */}
                  <select
                    value={qty}
                    disabled={availableStock === 0 || loading}
                    onChange={(e) => handleQuantityChange(product.id, Number(e.target.value))}
                    className="col-span-1 p-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>

                  {/* Reserve Button */}
                  <button
                    onClick={() => handleReserve(product)}
                    disabled={availableStock === 0 || loading}
                    className={`col-span-3 py-2.5 px-4 text-sm font-semibold rounded-xl text-white shadow-xs focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      availableStock === 0
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                        : 'bg-teal-700 hover:bg-teal-800'
                    } disabled:opacity-80`}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Holding...
                      </>
                    ) : availableStock === 0 ? (
                      'Out of Stock'
                    ) : (
                      <>
                        <WarehouseIcon className="w-4 h-4" />
                        Reserve Stock
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
