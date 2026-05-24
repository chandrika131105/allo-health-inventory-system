import prisma from '@/lib/prisma';
import CheckoutForm from '@/components/checkout-form';
import { Activity, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface CheckoutPageProps {
  params: Promise<{ id: string }>;
}

export const revalidate = 0; // Keeping checkout states strictly live

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { id } = await params;

  // 1. Fetch reservation data including product/warehouse relations on server side
  let reservation = null;
  try {
    reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        inventory: {
          include: {
            product: true,
            warehouse: true,
          },
        },
      },
    });
  } catch (error) {
    console.error(`Failed to fetch reservation ${id} on server side:`, error);
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <div className="p-2 bg-teal-50 rounded-xl border border-teal-100">
              <Activity className="w-5 h-5 text-teal-700" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-slate-900 text-base leading-none">Allo Health</span>
              <span className="text-[10px] text-slate-400 font-medium tracking-wide uppercase mt-0.5">
                Secure Checkout
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
            <span>Payment Gateway</span>
            <span className="px-2 py-0.5 bg-slate-100 rounded-md font-bold font-mono">SANDBOX</span>
          </div>
        </div>
      </header>

      {/* Main Form container */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {!reservation ? (
          <div className="max-w-md mx-auto text-center py-16 bg-white border border-slate-100 rounded-2xl p-8 shadow-xs space-y-4">
            <div className="mx-auto w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">Hold Not Found</h3>
              <p className="text-slate-500 text-sm mt-1">
                The requested inventory hold ID does not exist or has expired and been purged.
              </p>
            </div>
            <Link
              href="/"
              className="inline-block px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-xl transition-all"
            >
              Return to Catalog
            </Link>
          </div>
        ) : (
          <CheckoutForm
            reservation={{
              id: reservation.id,
              quantity: reservation.quantity,
              status: reservation.status,
              expiresAt: reservation.expiresAt.toISOString(),
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
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <span>&copy; 2026 Allo Health Inc. All rights reserved.</span>
          <span className="font-mono">Security: AES-256 TLS 1.3</span>
        </div>
      </footer>
    </div>
  );
}
