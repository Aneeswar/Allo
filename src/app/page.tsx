'use client';
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Package, 
  MapPin, 
  ShoppingCart, 
  AlertTriangle, 
  Loader2, 
  RefreshCw, 
  CheckCircle2 
} from 'lucide-react';

interface WarehouseStock {
  warehouseId: string;
  warehouseName: string;
  location: string;
  quantity: number;
  reserved: number;
  available: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  imageUrl: string | null;
  description: string | null;
  stocks: WarehouseStock[];
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form states per product card
  const [selectedWarehouses, setSelectedWarehouses] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  
  // Custom API Error Message to show at the top of the dashboard
  const [alertMessage, setAlertMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Fetch products from API
  const fetchProducts = async (showSilently = false) => {
    if (!showSilently) setLoading(true);
    try {
      const res = await fetch('/api/products');
      if (!res.ok) {
        throw new Error(`Failed to load products: ${res.statusText}`);
      }
      const data: Product[] = await res.json();
      setProducts(data);
      
      // Initialize default warehouse selections
      const defaultWarehouses: Record<string, string> = { ...selectedWarehouses };
      const defaultQuantities: Record<string, number> = { ...quantities };
      
      data.forEach((product) => {
        // If no warehouse selected yet, select the first one with available stock
        if (!defaultWarehouses[product.id]) {
          const firstInStock = product.stocks.find(s => s.available > 0);
          if (firstInStock) {
            defaultWarehouses[product.id] = firstInStock.warehouseId;
          } else if (product.stocks.length > 0) {
            defaultWarehouses[product.id] = product.stocks[0].warehouseId;
          }
        }
        
        // Initialize default quantity to 1
        if (!defaultQuantities[product.id]) {
          defaultQuantities[product.id] = 1;
        }
      });
      
      setSelectedWarehouses(defaultWarehouses);
      setQuantities(defaultQuantities);
      setError(null);
    } catch (error) {
      const err = error as Error;
      console.error(err);
      setError(err.message || 'An error occurred while loading products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProducts().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWarehouseChange = (productId: string, warehouseId: string) => {
    setSelectedWarehouses(prev => ({ ...prev, [productId]: warehouseId }));
    // Reset quantity back to 1 when changing warehouse
    setQuantities(prev => ({ ...prev, [productId]: 1 }));
  };

  const handleQuantityChange = (productId: string, quantity: number, max: number) => {
    const val = Math.min(Math.max(1, quantity), max || 1);
    setQuantities(prev => ({ ...prev, [productId]: val }));
  };

  // Submit Stock Reservation Request
  const handleReserve = async (productId: string) => {
    const warehouseId = selectedWarehouses[productId];
    const qty = quantities[productId] || 1;
    
    if (!warehouseId) {
      setAlertMessage({ type: 'error', text: 'Please select a warehouse' });
      return;
    }

    setSubmitting(prev => ({ ...prev, [productId]: true }));
    setAlertMessage(null);

    try {
      // Setup Idempotency Key header
      const idempotencyKey = `reserve_${productId}_${warehouseId}_${qty}_${Date.now()}`;

      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          productId,
          warehouseId,
          quantity: qty,
          expiresInMinutes: 10,
        }),
      });

      if (res.status === 409) {
        const errData = await res.json();
        setAlertMessage({
          type: 'error',
          text: `[Error 409] Reservation failed: ${errData.error || 'Insufficient stock'}. Please refresh and try again.`,
        });
        // Refresh products to fetch fresh stock numbers
        await fetchProducts(true);
        return;
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Server error occurred');
      }

      const reservation = await res.json();
      
      // Successfully reserved! Redirect to checkout page
      setAlertMessage({
        type: 'success',
        text: 'Hold reserved successfully! Redirecting you to secure checkout...',
      });
      
      setTimeout(() => {
        router.push(`/checkout/${reservation.id}`);
      }, 1200);

    } catch (error) {
      const err = error as Error;
      console.error(err);
      setAlertMessage({
        type: 'error',
        text: `Error: ${err.message || 'Failed to connect to reservation service.'}`,
      });
    } finally {
      setSubmitting(prev => ({ ...prev, [productId]: false }));
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl text-glow">
            Products Dashboard
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Select a warehouse to reserve real-time stock units. Reclaims expired holds automatically.
          </p>
        </div>
        <button
          onClick={() => fetchProducts()}
          disabled={loading}
          className="self-start md:self-auto inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-secondary text-secondary-foreground border border-border hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh Inventory
        </button>
      </div>

      {/* Global Alerts for 409/Other API Errors */}
      {alertMessage && (
        <div 
          className={`flex items-start p-4 rounded-xl border ${
            alertMessage.type === 'error' 
              ? 'bg-destructive/10 border-destructive/20 text-destructive-foreground' 
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          } animate-slideDown`}
        >
          {alertMessage.type === 'error' ? (
            <AlertTriangle className="h-5 w-5 mr-3 flex-shrink-0 mt-0.5 text-red-400" />
          ) : (
            <CheckCircle2 className="h-5 w-5 mr-3 flex-shrink-0 mt-0.5 text-emerald-400" />
          )}
          <div>
            <h3 className="font-semibold text-sm">
              {alertMessage.type === 'error' ? 'Reservation Error' : 'Success'}
            </h3>
            <p className="text-xs mt-1 text-gray-350">{alertMessage.text}</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-6 text-center glass-panel rounded-2xl border border-destructive/20 max-w-lg mx-auto">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
          <h3 className="font-display font-semibold text-lg text-white">Fulfillment Fetch Failed</h3>
          <p className="text-sm text-muted-foreground mt-2">{error}</p>
          <button
            onClick={() => fetchProducts()}
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && products.length === 0 && (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel rounded-2xl p-5 space-y-4 border border-border/40 animate-pulse">
              <div className="h-48 w-full bg-secondary/50 rounded-xl" />
              <div className="h-5 bg-secondary/50 rounded w-2/3" />
              <div className="h-3 bg-secondary/50 rounded w-full" />
              <div className="h-3 bg-secondary/50 rounded w-5/6" />
              <div className="space-y-2 mt-4 pt-4 border-t border-border/20">
                <div className="h-4 bg-secondary/50 rounded w-1/3" />
                <div className="h-4 bg-secondary/50 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Product Grid */}
      {!loading && products.length > 0 && (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const selectedWhId = selectedWarehouses[product.id];
            const selectedStock = product.stocks.find(s => s.warehouseId === selectedWhId);
            const availableStock = selectedStock ? selectedStock.available : 0;
            const isOutOfStockOverall = product.stocks.every(s => s.available <= 0);

            return (
              <div
                key={product.id}
                className="glass-panel rounded-2xl overflow-hidden border border-border/60 flex flex-col glass-card-hover"
              >
                {/* Product Image */}
                {product.imageUrl && (
                  <div className="relative h-48 w-full bg-gray-900 border-b border-border/40">
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-cover opacity-90 transition-transform duration-500 hover:scale-105"
                    />
                    <div className="absolute top-3 right-3 bg-background/80 backdrop-blur-md px-2.5 py-1 rounded-md text-xs font-mono font-medium border border-border">
                      {product.sku}
                    </div>
                  </div>
                )}

                {/* Card Body */}
                <div className="p-5 flex-grow flex flex-col justify-between space-y-4">
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <h2 className="font-display font-bold text-lg text-white group-hover:text-indigo-400 transition-colors">
                        {product.name}
                      </h2>
                      <span className="font-display font-bold text-indigo-400">
                        ${(product.price / 100).toFixed(2)}
                      </span>
                    </div>

                    {/* Description */}
                    {product.description && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                        {product.description}
                      </p>
                    )}

                    {/* Stock Levels by Warehouse */}
                    <div className="mt-4 pt-4 border-t border-border/20 space-y-2">
                      <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center">
                        <Package className="h-3 w-3 mr-1" /> Multi-Warehouse Stock
                      </h4>
                      <div className="space-y-1.5 mt-2">
                        {product.stocks.map((stock) => (
                          <div 
                            key={stock.warehouseId} 
                            className="flex justify-between items-center text-xs"
                          >
                            <span className="text-gray-400 flex items-center">
                              <MapPin className="h-3 w-3 mr-1 text-gray-500" />
                              {stock.warehouseName}
                            </span>
                            <div className="flex items-center space-x-1.5">
                              {stock.available > 0 ? (
                                <>
                                  <span className="font-medium text-white">{stock.available}</span>
                                  <span className="text-muted-foreground text-[10px]">av.</span>
                                  {stock.reserved > 0 && (
                                    <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-1 py-0.5 rounded border border-indigo-500/20">
                                      {stock.reserved} held
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-destructive font-medium px-1.5 py-0.5 bg-destructive/10 border border-destructive/20 rounded text-[10px]">
                                  Out of Stock
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Reservation Control Panel */}
                  <div className="pt-4 border-t border-border/20 space-y-3">
                    {isOutOfStockOverall ? (
                      <div className="text-center p-3 rounded-lg bg-destructive/5 border border-destructive/15">
                        <p className="text-xs text-destructive font-medium">
                          Permanently Depleted in All Warehouses
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {/* Warehouse Select */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                              Warehouse
                            </label>
                            <select
                              value={selectedWhId || ''}
                              onChange={(e) => handleWarehouseChange(product.id, e.target.value)}
                              className="w-full bg-secondary border border-border text-white text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              {product.stocks.map((stock) => (
                                <option 
                                  key={stock.warehouseId} 
                                  value={stock.warehouseId}
                                  disabled={stock.available <= 0}
                                >
                                  {stock.warehouseName} ({stock.available} left)
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Quantity Selector */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                              Qty to Reserve
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={availableStock}
                              value={quantities[product.id] || 1}
                              onChange={(e) => handleQuantityChange(product.id, parseInt(e.target.value), availableStock)}
                              className="w-full bg-secondary border border-border text-white text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </div>

                        {/* Submit Button */}
                        <button
                          onClick={() => handleReserve(product.id)}
                          disabled={submitting[product.id] || availableStock <= 0}
                          className="glow-button w-full inline-flex items-center justify-center py-2.5 px-4 rounded-lg bg-primary hover:bg-indigo-500 text-primary-foreground text-xs font-semibold tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {submitting[product.id] ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                              Securing Hold...
                            </>
                          ) : (
                            <>
                              <ShoppingCart className="h-3.5 w-3.5 mr-2" />
                              Reserve for Checkout
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
