'use client';
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ShieldCheck, 
  XCircle, 
  Clock, 
  Loader2, 
  ArrowLeft, 
  MapPin, 
  Package, 
  CheckCircle2, 
  ShoppingBag,
  AlertOctagon
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  imageUrl: string | null;
  description: string | null;
}

interface Warehouse {
  id: string;
  name: string;
  location: string | null;
}

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED';
  expiresAt: string;
  product: Product;
  warehouse: Warehouse;
}

export default function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  // Unwrap params using React.use()
  const { id } = use(params);
  const router = useRouter();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Timer state
  const [timeLeft, setTimeLeft] = useState<number>(0); // in seconds
  const [expired, setExpired] = useState<boolean>(false);
  
  // Action states
  const [confirming, setConfirming] = useState<boolean>(false);
  const [cancelling, setCancelling] = useState<boolean>(false);
  
  // View state transitions (success / cancelled / expired)
  const [orderState, setOrderState] = useState<'checkout' | 'success' | 'cancelled' | 'expired'>('checkout');

  // Fetch reservation details
  useEffect(() => {
    const fetchReservation = async () => {
      try {
        const res = await fetch(`/api/reservations/${id}`);
        
        if (res.status === 404) {
          throw new Error('Reservation not found');
        }
        if (!res.ok) {
          throw new Error('Failed to load reservation details');
        }
        
        const data: Reservation = await res.json();
        setReservation(data);

        // Adjust view based on status
        if (data.status === 'CONFIRMED') {
          setOrderState('success');
        } else if (data.status === 'RELEASED') {
          setOrderState('expired');
          setExpired(true);
        } else {
          // It's pending, calculate remaining time
          const expiryTime = new Date(data.expiresAt).getTime();
          const remainingSecs = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
          
          if (remainingSecs <= 0) {
            setExpired(true);
            setOrderState('expired');
          } else {
            setTimeLeft(remainingSecs);
          }
        }
      } catch (error) {
        const err = error as Error;
        console.error(err);
        setError(err.message || 'An error occurred.');
      } finally {
        setLoading(false);
      }
    };

    fetchReservation();
  }, [id]);

  // Countdown timer clock
  useEffect(() => {
    if (timeLeft <= 0 || orderState !== 'checkout') return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setExpired(true);
          setOrderState('expired');
          
          // Lazily notify the server that the timer ran out
          fetch(`/api/reservations/${id}/release`, { method: 'POST' }).catch(() => {});
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, orderState, id]);

  // Format seconds to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Confirm Reservation (Confirm payment)
  const handleConfirm = async () => {
    if (!reservation || expired) return;

    setConfirming(true);
    setError(null);

    try {
      const idempotencyKey = `confirm_${id}_${Date.now()}`;
      
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
      });

      if (res.status === 410) {
        // Reservation expired
        setExpired(true);
        setOrderState('expired');
        setError('[Error 410] Your stock reservation has expired. The units were returned to available inventory.');
        return;
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Confirm request failed.');
      }

      // Successful payment confirmation!
      setOrderState('success');
    } catch (error) {
      const err = error as Error;
      console.error(err);
      setError(err.message || 'Failed to confirm reservation.');
    } finally {
      setConfirming(false);
    }
  };

  // Cancel Hold Early
  const handleCancel = async () => {
    if (!reservation) return;

    setCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Release request failed.');
      }

      // Successfully cancelled
      setOrderState('cancelled');
    } catch (error) {
      const err = error as Error;
      console.error(err);
      setError(err.message || 'Failed to release reservation.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Retrieving reservation hold details...</p>
      </div>
    );
  }

  if (error && orderState === 'checkout' && !reservation) {
    return (
      <div className="max-w-md mx-auto text-center py-12 space-y-6 animate-fadeIn">
        <div className="inline-flex p-4 bg-destructive/10 border border-destructive/20 rounded-full">
          <XCircle className="h-10 w-10 text-destructive" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display font-bold text-xl text-white">Fulfillment Lookup Failed</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center text-xs font-semibold text-indigo-400 hover:text-indigo-300"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Products Catalog
        </button>
      </div>
    );
  }

  // SCREEN 1: Success Checkout Screen
  if (orderState === 'success' && reservation) {
    const totalCost = (reservation.product.price * reservation.quantity) / 100;
    return (
      <div className="max-w-lg mx-auto bg-card/40 border border-border/60 rounded-3xl p-8 text-center space-y-8 animate-scaleUp">
        <div className="inline-flex p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
          <CheckCircle2 className="h-12 w-12 text-emerald-400 text-glow" />
        </div>
        
        <div className="space-y-2">
          <h2 className="font-display font-bold text-2xl text-white tracking-wide">Fulfillment Secured</h2>
          <p className="text-sm text-emerald-400 font-medium">Payment Succeeded & Stock Decremented</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Order confirmed. Your reserved units in **{reservation.warehouse.name}** have been permanently marked for shipment.
          </p>
        </div>

        {/* Order Card */}
        <div className="glass-panel rounded-2xl p-5 text-left border border-border/40 space-y-3 font-sans">
          <div className="flex justify-between items-center pb-3 border-b border-border/20">
            <span className="text-xs text-muted-foreground">Reservation ID</span>
            <span className="text-xs font-mono text-white">{reservation.id.substring(0, 12)}...</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-300 font-medium">{reservation.product.name}</span>
            <span className="text-white">x{reservation.quantity}</span>
          </div>
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>Warehouse Origin</span>
            <span>{reservation.warehouse.name}</span>
          </div>
          <div className="flex justify-between items-center pt-3 border-t border-border/20 font-display font-bold text-white text-base">
            <span>Total Paid</span>
            <span>${totalCost.toFixed(2)}</span>
          </div>
        </div>

        <button
          onClick={() => router.push('/')}
          className="w-full inline-flex items-center justify-center py-2.5 px-4 rounded-xl bg-primary hover:bg-indigo-500 text-white font-semibold text-xs tracking-wide transition-all shadow-md shadow-indigo-500/10 cursor-pointer"
        >
          <ShoppingBag className="h-4 w-4 mr-2" />
          Continue Shopping
        </button>
      </div>
    );
  }

  // SCREEN 2: Cancelled Screen
  if (orderState === 'cancelled') {
    return (
      <div className="max-w-md mx-auto text-center py-12 space-y-6 animate-fadeIn">
        <div className="inline-flex p-4 bg-secondary border border-border rounded-full">
          <XCircle className="h-10 w-10 text-gray-400" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display font-bold text-xl text-white">Reservation Cancelled</h2>
          <p className="text-sm text-muted-foreground">
            You released the stock hold. The reserved units have been immediately returned to available warehouse stock.
          </p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-2.5 bg-secondary text-white hover:bg-gray-800 border border-border rounded-xl text-xs font-semibold cursor-pointer"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  // SCREEN 3: Expired Screen
  if (orderState === 'expired' && reservation) {
    return (
      <div className="max-w-md mx-auto text-center py-12 space-y-6 animate-fadeIn">
        <div className="inline-flex p-4 bg-destructive/10 border border-destructive/20 rounded-full">
          <AlertOctagon className="h-10 w-10 text-destructive" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display font-bold text-xl text-white">Reservation Expired (Error 410)</h2>
          <p className="text-sm text-muted-foreground">
            The 10-minute hold window for these units has timed out. 
            The inventory has been released so other shoppers can buy it.
          </p>
        </div>
        {error && <p className="text-xs text-red-400 max-w-sm mx-auto">{error}</p>}
        <button
          onClick={() => router.push('/')}
          className="px-6 py-2.5 bg-primary hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white tracking-wide cursor-pointer"
        >
          Browse Products
        </button>
      </div>
    );
  }

  // SCREEN 4: Active Checkout / Pay Screen
  const totalCost = reservation ? (reservation.product.price * reservation.quantity) / 100 : 0;
  const isTimeCritical = timeLeft < 60; // Less than 1 minute remaining

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start animate-fadeIn">
      {/* Checkout details - Left / 2 Columns */}
      <div className="md:col-span-2 space-y-6">
        <div className="glass-panel rounded-3xl p-6 border border-border/60 space-y-6">
          <div className="flex items-center space-x-3 pb-4 border-b border-border/20">
            <ShieldCheck className="h-6 w-6 text-indigo-400" />
            <div>
              <h2 className="font-display font-bold text-lg text-white">Stock Hold Secured</h2>
              <p className="text-xs text-muted-foreground">Your units are safely reserved in our database.</p>
            </div>
          </div>

          {/* Product summary */}
          <div className="flex space-x-4">
            {reservation?.product.imageUrl && (
              <img 
                src={reservation.product.imageUrl} 
                alt={reservation.product.name} 
                className="h-20 w-20 rounded-xl object-cover border border-border bg-gray-900"
              />
            )}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">{reservation?.product.name}</h3>
              <p className="text-xs text-muted-foreground">{reservation?.product.description}</p>
              <div className="flex space-x-3 items-center pt-1.5">
                <span className="text-xs font-mono bg-secondary px-2 py-0.5 rounded text-gray-300">
                  {reservation?.product.sku}
                </span>
                <span className="text-xs text-indigo-400 font-bold">
                  ${((reservation?.product.price || 0) / 100).toFixed(2)} each
                </span>
              </div>
            </div>
          </div>

          {/* Fulfillment details */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/20 text-xs">
            <div className="space-y-1">
              <span className="text-muted-foreground">Dispatch Warehouse</span>
              <p className="text-white font-medium flex items-center mt-1">
                <MapPin className="h-3 w-3 mr-1 text-gray-500" />
                {reservation?.warehouse.name}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">Quantity Reserved</span>
              <p className="text-white font-medium flex items-center mt-1">
                <Package className="h-3 w-3 mr-1 text-gray-500" />
                {reservation?.quantity} units
              </p>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <button
          onClick={handleCancel}
          disabled={cancelling || confirming}
          className="inline-flex items-center text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Re-select items (cancels current hold)
        </button>
      </div>

      {/* Expiry & Payment Panel - Right / 1 Column */}
      <div className="space-y-6">
        <div className="glass-panel rounded-3xl p-6 border border-border/60 space-y-6">
          {/* Expiry Countdown */}
          <div className="text-center space-y-2">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-center">
              <Clock className="h-3.5 w-3.5 mr-1 text-gray-500" /> Time Remaining to Pay
            </span>
            <div 
              className={`font-mono text-4xl font-bold tracking-tight py-2 px-4 rounded-xl inline-block ${
                isTimeCritical 
                  ? 'bg-destructive/10 text-destructive border border-destructive/20 animate-pulse text-red-500' 
                  : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
              }`}
            >
              {formatTime(timeLeft)}
            </div>
            <p className="text-[10px] text-muted-foreground max-w-[200px] mx-auto">
              If the timer expires, the units will return to the active inventory pool.
            </p>
          </div>

          {/* Payment summary */}
          <div className="pt-4 border-t border-border/20 space-y-2 text-sm font-sans">
            <div className="flex justify-between items-center text-gray-400">
              <span>Quantity</span>
              <span>x{reservation?.quantity}</span>
            </div>
            <div className="flex justify-between items-center font-bold text-white text-base pt-2 border-t border-border/10">
              <span>Order Total</span>
              <span className="text-indigo-400">${totalCost.toFixed(2)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2 pt-2">
            <button
              onClick={handleConfirm}
              disabled={confirming || cancelling || expired}
              className="glow-button w-full inline-flex items-center justify-center py-3 px-4 rounded-xl bg-primary hover:bg-indigo-500 text-white text-xs font-semibold tracking-wide shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Securing Order...
                </>
              ) : (
                'Confirm Purchase'
              )}
            </button>

            <button
              onClick={handleCancel}
              disabled={confirming || cancelling || expired}
              className="w-full inline-flex items-center justify-center py-3 px-4 rounded-xl bg-secondary text-secondary-foreground hover:bg-gray-800 border border-border text-xs font-semibold tracking-wide transition-colors disabled:opacity-50 cursor-pointer"
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling Hold...
                </>
              ) : (
                'Cancel Order'
              )}
            </button>
          </div>
        </div>

        {/* Global Error Notice */}
        {error && (
          <div className="flex p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive-foreground text-xs">
            <XCircle className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5 text-red-400" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
