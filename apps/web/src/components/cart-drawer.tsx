'use client';

import { useState } from 'react';

type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  retailerName: string;
};

export default function CartDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<CartItem[]>([]);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const updateQuantity = (id: string, delta: number) => {
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null),
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <>
      {/* Floating Cart Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 bg-brand-primary-fill-strong text-white font-extrabold text-xs px-4 py-3 rounded-full shadow-2xl hover:brightness-110 transition-all flex items-center gap-2 border border-brand-border cursor-pointer active:scale-95"
      >
        <span>🛒</span>
        <span>Your order</span>
        <span className="bg-white text-brand-primary-text font-black text-[10px] px-2 py-0.5 rounded-full">
          {items.reduce((sum, i) => sum + i.quantity, 0)}
        </span>
      </button>

      {/* Cart Drawer Slide-out Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-md bg-brand-surface border-l border-brand-border h-full flex flex-col justify-between p-6 shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-brand-border pb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-brand-muted bg-brand-background border border-brand-border px-2 py-0.5 rounded">
                  Your order
                </span>
                <h2 className="text-xl font-extrabold text-brand-text mt-1">Your Shopping Cart</h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-brand-muted hover:text-brand-text font-bold text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Cart Items List */}
            <div className="flex-grow overflow-y-auto py-6 space-y-4">
              {items.length === 0 ? (
                <div className="text-center py-12 text-brand-muted space-y-2">
                  <p className="font-bold text-brand-text text-sm">Your order list is empty.</p>
                  <p className="text-xs max-w-xs mx-auto">
                    Browse dispensary profiles and add evidence-verified products to stage your order.
                  </p>
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="border border-brand-border bg-brand-background/40 rounded-lg p-4 flex items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-brand-text">{item.name}</h4>
                      <p className="text-[10px] text-brand-muted">{item.retailerName}</p>
                      <div className="text-xs font-black text-brand-text">${(item.price * item.quantity).toFixed(2)}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-6 h-6 rounded border border-brand-border bg-brand-surface text-xs font-bold flex items-center justify-center hover:bg-brand-primary-fill-strong hover:text-white hover:border-brand-primary transition-colors"
                      >
                        -
                      </button>
                      <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-6 h-6 rounded border border-brand-border bg-brand-surface text-xs font-bold flex items-center justify-center hover:bg-brand-primary-fill-strong hover:text-white hover:border-brand-primary transition-colors"
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-brand-muted hover:text-red-600 text-xs ml-2"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer subtotal & retailer handoff */}
            <div className="border-t border-brand-border pt-4 space-y-4">
              <div className="flex justify-between items-center text-sm font-extrabold text-brand-text">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-brand-muted">
                Totals here are estimates. Availability, pricing, and licensure are confirmed directly with the retailer before any purchase.
              </p>
              <button
                disabled={items.length === 0}
                className="w-full bg-brand-primary-fill-strong text-white font-extrabold text-xs py-3 px-4 rounded-md hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer shadow"
              >
                Proceed to Staged Handoff →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
