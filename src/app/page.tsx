import prisma from '@/lib/prisma';
import { InventoryService, ProductWithStock } from '@/lib/services/inventory.service';
import ProductListing from '@/components/product-listing';
import { Activity } from 'lucide-react';

export const revalidate = 0; // Disable server component cache to keep counts live

export default async function Home() {
  // 1. Fetch initial stock levels on the server (high performance, SEO friendly)
  let initialProducts: ProductWithStock[] = [];
  try {
    initialProducts = await InventoryService.getProductsWithStock();
  } catch (error) {
    console.error('Failed to load products on server side:', error);
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-teal-50 dark:bg-teal-950/40 rounded-xl border border-teal-100 dark:border-teal-900/30">
              <Activity className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-slate-900 dark:text-slate-50 text-base leading-none">
                Allo Health
              </span>
              <span className="text-[10px] text-slate-400 font-medium tracking-wide uppercase mt-0.5">
                Inventory Platform
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-semibold text-slate-500 font-mono">LIVE SYSTEMS</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {initialProducts.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-100 rounded-2xl p-8 shadow-xs">
            <p className="text-slate-500 text-sm font-medium">No products found in the catalog.</p>
            <p className="text-slate-400 text-xs mt-1">Please ensure your database is seeded using `npm run seed`.</p>
          </div>
        ) : (
          <ProductListing initialProducts={initialProducts} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 dark:bg-slate-950/20 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <span>&copy; 2026 Allo Health Inc. All rights reserved.</span>
          <div className="flex gap-4 font-mono">
            <span>Isolation: READ COMMITTED</span>
            <span>Locks: SELECT FOR UPDATE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
