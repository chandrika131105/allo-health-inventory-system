'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import {
  ShieldAlert,
  Loader2,
  CheckCircle,
  XCircle,
  Calendar,
  DollarSign,
  Package,
  ArrowLeft,
} from 'lucide-react';

interface CheckoutFormProps {
  reservation: {
    id: string;
    quantity: number;
    status: string;
    expiresAt: string;
    product: {
      id: string;
      name: string;
      sku: string;
      price: number;
    };
    warehouse: {
      id: string;
      name: string;
      code: string;
    };
  };
}

export default function CheckoutForm({ reservation: initialReservation }: CheckoutFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [reservation, setReservation] = useState(initialReservation);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const expiresAtMs = new Date(reservation.expiresAt).getTime();
  const isPending = reservation.status === 'PENDING';

  // 1. Live Countdown Timer effect
  useEffect(() => {
    if (!isPending) return;

    const calculateTimeLeft = () => {
      const difference = expiresAtMs - Date.now();
      return Math.max(0, difference);
    };

    setTimeLeft(calculateTimeLeft());

    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
        setReservation((prev) => ({ ...prev, status: 'EXPIRED' }));
        toast('Reservation window has expired. Stock released.', 'error', 'Expired');
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAtMs, isPending, toast]);

  // Format time remaining (mm:ss)
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // 2. Handle Purchase Confirmation
  const handleConfirm = async () => {
    if (timeLeft <= 0 && isPending) {
      toast('Cannot confirm. The reservation hold has expired.', 'error', 'Expired');
      return;
    }

    setIsConfirming(true);

    // Generate unique idempotency key for confirmation
    const idempotencyKey = `idemp-confirm-${reservation.id}-${Date.now()}`;

    try {
      const response = await fetch(`/api/reservations/${reservation.id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      });

      const resJson = await response.json();

      if (response.status === 200 && resJson.success) {
        setReservation((prev) => ({ ...prev, status: 'CONFIRMED' }));
        toast('Purchase confirmed successfully! Inventory updated.', 'success', 'Order Confirmed');
      } else {
        const errMsg = resJson.error?.message || 'Failed to confirm purchase.';
        if (response.status === 410) {
          // Lazy clean-up triggered on server
          setReservation((prev) => ({ ...prev, status: 'EXPIRED' }));
          toast('Server returned 410: Hold expired before confirmation.', 'error', 'Expired');
        } else {
          toast(errMsg, 'error', 'Confirmation Error');
        }
      }
    } catch (err) {
      toast('Network connection failed during confirmation.', 'error', 'Connection Error');
    } finally {
      setIsConfirming(false);
    }
  };

  // 3. Handle Reservation Early Release (Cancel)
  const handleCancel = async () => {
    setIsCancelling(true);

    try {
      const response = await fetch(`/api/reservations/${reservation.id}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const resJson = await response.json();

      if (response.status === 200 && resJson.success) {
        setReservation((prev) => ({ ...prev, status: 'RELEASED' }));
        toast('Reservation hold released. Stock returned to pool.', 'info', 'Hold Cancelled');
        // Wait a second and redirect back to listing
        setTimeout(() => router.push('/'), 1200);
      } else {
        const errMsg = resJson.error?.message || 'Failed to release hold.';
        toast(errMsg, 'error', 'Release Error');
      }
    } catch (err) {
      toast('Network connection failed during release.', 'error', 'Connection Error');
    } finally {
      setIsCancelling(false);
    }
  };

  const unitPrice = reservation.product.price;
  const totalPrice = unitPrice * reservation.quantity;

  const isLowTime = timeLeft > 0 && timeLeft < 60000; // less than 60s

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/')}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors uppercase tracking-wider cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Return to Catalog
      </button>

      {/* Main card */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-xs">
        {/* Reservation Status Header */}
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Secure Checkout</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">Hold ID: {reservation.id}</p>
          </div>
          <div>
            {reservation.status === 'PENDING' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulsing-dot"></span>
                Stock Reserved
              </span>
            )}
            {reservation.status === 'CONFIRMED' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                <CheckCircle className="w-3.5 h-3.5" />
                Completed
              </span>
            )}
            {reservation.status === 'RELEASED' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-50 text-slate-700 border border-slate-100">
                <XCircle className="w-3.5 h-3.5" />
                Released
              </span>
            )}
            {reservation.status === 'EXPIRED' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-100">
                <ShieldAlert className="w-3.5 h-3.5" />
                Expired
              </span>
            )}
          </div>
        </div>

        {/* Live Timer Section */}
        {reservation.status === 'PENDING' && (
          <div
            className={`p-4 border-b text-center transition-all ${
              isLowTime
                ? 'bg-red-50/50 border-red-100 text-red-900 animate-pulse'
                : 'bg-teal-50/30 border-teal-50 text-slate-700'
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Time Remaining to Checkout
            </div>
            <div className={`text-3xl font-mono font-bold ${isLowTime ? 'text-red-600' : 'text-teal-700'}`}>
              {formatTime(timeLeft)}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Your stock hold is guaranteed. Complete purchase before the timer runs out.
            </p>
          </div>
        )}

        {/* Receipt / Details */}
        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider border-b border-slate-50 pb-2">
              Purchase Summary
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-slate-50 rounded-xl">
                  <Package className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Product details</div>
                  <div className="font-semibold text-sm text-slate-950">
                    {reservation.product.name}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    SKU: {reservation.product.sku}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-slate-50 rounded-xl">
                  <Calendar className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Warehouse location</div>
                  <div className="font-semibold text-sm text-slate-950">
                    {reservation.warehouse.name}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    Code: {reservation.warehouse.code}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing Calculation Table */}
          <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Item Price</span>
              <span>${unitPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Quantity Reserved</span>
              <span>&times; {reservation.quantity}</span>
            </div>
            <div className="flex justify-between font-semibold text-sm text-slate-900 border-t border-slate-100 pt-2 mt-2">
              <span>Total Price</span>
              <span className="flex items-center text-teal-700">
                <DollarSign className="w-4 h-4 -mr-0.5" />
                {totalPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-50">
            {reservation.status === 'PENDING' ? (
              <>
                <button
                  onClick={handleCancel}
                  disabled={isConfirming || isCancelling}
                  className="flex-1 py-3 px-4 text-sm font-semibold border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    'Cancel Hold & Release'
                  )}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isConfirming || isCancelling}
                  className="flex-1 py-3 px-4 text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-xl shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  {isConfirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    'Confirm Purchase'
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={() => router.push('/')}
                className="w-full py-3 px-4 text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                Return to Product Catalog
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expiry Warning Overlay Card */}
      {reservation.status === 'EXPIRED' && (
        <div className="bg-red-50/50 border border-red-100 rounded-2xl p-6 text-center space-y-4 shadow-xs">
          <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-red-900 text-base">Reservation Expired</h4>
            <p className="text-sm text-red-700/80 max-w-md mx-auto">
              Your 10-minute hold window closed before payment was finalized. The inventory was safely released back to other shoppers.
            </p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            Find Another Product
          </button>
        </div>
      )}

      {/* Success Summary Info */}
      {reservation.status === 'CONFIRMED' && (
        <div className="bg-teal-50/50 border border-teal-100 rounded-2xl p-6 text-center space-y-4 shadow-xs">
          <div className="mx-auto w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center text-teal-600">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-teal-900 text-base">Payment Successful!</h4>
            <p className="text-sm text-teal-700/80 max-w-md mx-auto">
              Thank you for your order. The stock has been permanently allocated from the warehouse for fulfillment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
