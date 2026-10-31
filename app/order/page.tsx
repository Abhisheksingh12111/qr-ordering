'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { APP_NAME, CURRENCY_SYMBOL } from '@/lib/constants';
import { CafeTable, MenuItem, CartItem, Session } from '@/lib/types';

export default function CustomerOrderPage() {
  const router = useRouter();

  const [step, setStep] = useState<'loading' | 'name' | 'table' | 'menu'>('loading');
  const [customerName, setCustomerName] = useState('');
  
  // Table fetching and state management
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [loadingTables, setLoadingTables] = useState<boolean>(false);
  const [tableError, setTableError] = useState<string | null>(null);

  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Menu & Cart state
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [orderPlacing, setOrderPlacing] = useState(false);

  // 1. Check existing session in localStorage on mount
  useEffect(() => {
    const checkSession = async () => {
      const storedSessionId = localStorage.getItem('brew_bite_session_id');
      if (storedSessionId) {
        const { data: session, error } = await supabase
          .from('sessions')
          .select('*')
          .eq('id', storedSessionId)
          .single();

        if (error) {
          console.error('Error fetching stored session:', error.message);
          localStorage.removeItem('brew_bite_session_id');
        } else if (session && session.status === 'active') {
          setActiveSession(session);
          setCustomerName(session.customer_name);
          setSelectedTable(session.table_id);
          await fetchMenu();
          setStep('menu');
          return;
        } else {
          localStorage.removeItem('brew_bite_session_id');
        }
      }
      setStep('name');
    };

    checkSession();
  }, []);

  // 2. Fetch all tables from Supabase when step is 'table' using useEffect
  useEffect(() => {
    if (step === 'table') {
      fetchTables();

      const channel = supabase
        .channel('tables_realtime_customer')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'cafe_tables' },
          () => {
            fetchTables();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [step]);

  const fetchTables = async () => {
    setLoadingTables(true);
    setTableError(null);

    const { data, error } = await supabase
      .from('cafe_tables')
      .select('*')
      .order('number', { ascending: true });

    setLoadingTables(false);

    if (error) {
      const errMessage = `Supabase query error: ${error.message}`;
      console.error(errMessage);
      setTableError(errMessage);
      setTables([]);
      return;
    }

    if (!data || data.length === 0) {
      const errMessage = 'No tables found in the database. Please run the setup SQL.';
      console.error(errMessage);
      setTableError(errMessage);
      setTables([]);
      return;
    }

    setTables(data);
  };

  const fetchMenu = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('available', true)
      .order('id', { ascending: true });

    if (error) {
      console.error('Error fetching menu:', error.message);
    } else if (data) {
      setMenuItems(data);
      const uniqueCats = Array.from(new Set(data.map((item) => item.category)));
      setCategories(['All', ...uniqueCats]);
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) return;
    setStep('table');
  };

  // Confirm Table selection & Handle Race Condition
  const handleConfirmTable = async () => {
    if (!selectedTable || !customerName.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    // Atomically claim table
    const { data: updatedTables, error: tableErr } = await supabase
      .from('cafe_tables')
      .update({ status: 'occupied' })
      .eq('id', selectedTable)
      .eq('status', 'free')
      .select();

    if (tableErr) {
      console.error('Table update error:', tableErr.message);
      setErrorMsg(`Table reservation error: ${tableErr.message}`);
      setIsSubmitting(false);
      return;
    }

    if (!updatedTables || updatedTables.length === 0) {
      setErrorMsg('This table was just taken! Please select another table.');
      setIsSubmitting(false);
      fetchTables();
      setSelectedTable(null);
      return;
    }

    // Create Session
    const { data: sessionData, error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        customer_name: customerName.trim(),
        table_id: selectedTable,
        status: 'active',
      })
      .select()
      .single();

    if (sessionErr || !sessionData) {
      console.error('Session creation error:', sessionErr?.message);
      setErrorMsg(`Failed to create session: ${sessionErr?.message || 'Unknown error'}`);
      await supabase.from('cafe_tables').update({ status: 'free' }).eq('id', selectedTable);
      setIsSubmitting(false);
      return;
    }

    localStorage.setItem('brew_bite_session_id', sessionData.id);
    setActiveSession(sessionData);
    await fetchMenu();
    setIsSubmitting(false);
    setStep('menu');
  };

  // Cart operations
  const updateQuantity = (itemId: number, delta: number) => {
    setCart((prev) => {
      const currentQty = prev[itemId] || 0;
      const newQty = currentQty + delta;
      if (newQty <= 0) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: newQty };
    });
  };

  const totalCartCount = Object.values(cart).reduce((sum, q) => sum + q, 0);
  const totalCartPrice = Object.entries(cart).reduce((sum, [itemId, qty]) => {
    const item = menuItems.find((m) => m.id === Number(itemId));
    return sum + (item ? item.price * qty : 0);
  }, 0);

  const handlePlaceOrder = async () => {
    if (!activeSession || totalCartCount === 0) return;
    setOrderPlacing(true);
    setErrorMsg(null);

    try {
      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert({
          session_id: activeSession.id,
          status: 'new',
        })
        .select()
        .single();

      if (orderErr || !orderData) {
        console.error('Order creation error:', orderErr?.message);
        throw new Error(orderErr?.message || 'Could not create order.');
      }

      const orderItemsToInsert = Object.entries(cart).map(([itemId, quantity]) => {
        const item = menuItems.find((m) => m.id === Number(itemId));
        return {
          order_id: orderData.id,
          item_name: item?.name || 'Unknown',
          price: item?.price || 0,
          quantity,
        };
      });

      const { error: itemsErr } = await supabase
        .from('order_items')
        .insert(orderItemsToInsert);

      if (itemsErr) {
        console.error('Order items insertion error:', itemsErr.message);
        throw new Error(itemsErr.message || 'Could not save order items.');
      }

      setCart({});
      router.push('/order/my-order');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error placing order.');
    } finally {
      setOrderPlacing(false);
    }
  };

  const filteredMenuItems = activeCategory === 'All'
    ? menuItems
    : menuItems.filter((item) => item.category === activeCategory);

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50/50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-stone-600 font-medium">Loading {APP_NAME}...</p>
        </div>
      </div>
    );
  }

  // Filter free tables from the fetched list
  const freeTables = tables.filter((t) => t.status === 'free');

  return (
    <div className="min-h-screen max-w-md mx-auto bg-stone-50 pb-28 shadow-2xl relative border-x border-stone-200/60">
      <header className="sticky top-0 z-30 bg-amber-900 text-amber-50 p-4 shadow-md flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg leading-tight">{APP_NAME}</h1>
          {activeSession && (
            <p className="text-xs text-amber-200 font-medium">
              Table {activeSession.table_id} • {activeSession.customer_name}
            </p>
          )}
        </div>
        {activeSession && (
          <button
            onClick={() => router.push('/order/my-order')}
            className="bg-amber-700/80 hover:bg-amber-700 text-amber-100 text-xs font-semibold px-3 py-2 rounded-xl transition border border-amber-600/50 flex items-center gap-1.5"
          >
            <span>🧾</span> Mera Order
          </button>
        )}
      </header>

      {errorMsg && (
        <div className="m-4 p-3 bg-rose-100 border border-rose-300 text-rose-800 text-sm rounded-xl flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="font-bold text-rose-900 ml-2">✕</button>
        </div>
      )}

      {/* STEP 1: Customer Name */}
      {step === 'name' && (
        <div className="p-6 space-y-6">
          <div className="text-center pt-6 space-y-2">
            <span className="text-5xl">👋</span>
            <h2 className="text-2xl font-bold text-stone-800">Welcome to {APP_NAME}</h2>
            <p className="text-stone-500 text-sm">Please enter your name to view available tables.</p>
          </div>

          <form onSubmit={handleNameSubmit} className="space-y-4 pt-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                Your Name
              </label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="w-full px-4 py-3.5 rounded-2xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-base shadow-sm"
              />
            </div>
            <button
              type="submit"
              disabled={!customerName.trim()}
              className="w-full py-4 bg-amber-600 text-white font-bold rounded-2xl shadow-lg shadow-amber-600/30 disabled:opacity-50 hover:bg-amber-700 transition active:scale-98"
            >
              Select Table →
            </button>
          </form>
        </div>
      )}

      {/* STEP 2: Select Table */}
      {step === 'table' && (
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-stone-800">Pick a Table</h2>
              <p className="text-xs text-stone-500">Hi {customerName}, select where you are seated.</p>
            </div>
            <button
              onClick={() => setStep('name')}
              className="text-xs text-amber-700 underline font-medium"
            >
              Change Name
            </button>
          </div>

          {/* Visible Loading State */}
          {loadingTables ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 bg-white rounded-2xl border border-stone-200">
              <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-stone-500 text-sm font-medium">Loading available tables...</p>
            </div>
          ) : tableError ? (
            /* Visible Red Box for Query/Database Errors */
            <div className="p-4 bg-rose-100 border border-rose-300 text-rose-800 text-sm rounded-2xl space-y-2">
              <p className="font-bold">⚠️ Database Error</p>
              <p>{tableError}</p>
              <button
                onClick={fetchTables}
                className="mt-2 px-4 py-2 bg-rose-600 text-white font-bold text-xs rounded-xl shadow"
              >
                Retry
              </button>
            </div>
          ) : freeTables.length === 0 ? (
            /* Shown ONLY when query succeeded and returned rows, but none have status 'free' */
            <div className="bg-amber-50 p-6 rounded-2xl border border-amber-200 text-center space-y-2">
              <span className="text-3xl">☕</span>
              <p className="font-semibold text-amber-900">All tables are currently occupied</p>
              <p className="text-xs text-amber-700">Please wait for a table to clear. Refreshing automatically...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {freeTables.map((table) => {
                const isSelected = selectedTable === table.id;
                return (
                  <button
                    key={table.id}
                    onClick={() => setSelectedTable(table.id)}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between h-24 ${
                      isSelected
                        ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-600 ring-offset-1'
                        : 'bg-white border-stone-200 text-stone-800 hover:border-amber-400'
                    }`}
                  >
                    <span className={`text-xs font-semibold ${isSelected ? 'text-amber-100' : 'text-stone-400'}`}>
                      TABLE
                    </span>
                    <span className="text-2xl font-black">#{table.number}</span>
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${isSelected ? 'text-amber-100' : 'text-emerald-600'}`}>
                      ● Available
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!loadingTables && !tableError && freeTables.length > 0 && (
            <button
              onClick={handleConfirmTable}
              disabled={!selectedTable || isSubmitting}
              className="w-full py-4 bg-amber-600 text-white font-bold rounded-2xl shadow-lg shadow-amber-600/30 disabled:opacity-50 hover:bg-amber-700 transition flex items-center justify-center gap-2 active:scale-98"
            >
              {isSubmitting ? (
                <>
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Reserving Table...</span>
                </>
              ) : (
                'Confirm Table & View Menu'
              )}
            </button>
          )}
        </div>
      )}

      {/* STEP 3: Menu & Ordering */}
      {step === 'menu' && (
        <div className="space-y-4">
          <div className="sticky top-14 z-20 bg-stone-50/95 backdrop-blur-md border-b border-stone-200 py-3 px-4 flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                  activeCategory === category
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-stone-200/80 text-stone-600 hover:bg-stone-300'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-3">
            {filteredMenuItems.map((item) => {
              const qty = cart[item.id] || 0;
              return (
                <div
                  key={item.id}
                  className="bg-white p-4 rounded-2xl border border-stone-200/70 shadow-sm flex items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                      {item.category}
                    </span>
                    <h3 className="font-bold text-stone-800 text-base leading-snug">{item.name}</h3>
                    <p className="text-stone-900 font-extrabold text-sm">
                      {CURRENCY_SYMBOL}{item.price}
                    </p>
                  </div>

                  {qty === 0 ? (
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-xs rounded-xl transition border border-amber-300/60 active:scale-95"
                    >
                      + ADD
                    </button>
                  ) : (
                    <div className="flex items-center bg-amber-800 text-white rounded-xl shadow-sm overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="px-3 py-1.5 font-bold hover:bg-amber-900 text-sm active:scale-95 transition"
                      >
                        -
                      </button>
                      <span className="px-2 font-black text-xs min-w-[20px] text-center">{qty}</span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="px-3 py-1.5 font-bold hover:bg-amber-900 text-sm active:scale-95 transition"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalCartCount > 0 && (
            <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 z-40 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent">
              <div className="bg-amber-900 text-white p-4 rounded-2xl shadow-xl flex items-center justify-between border border-amber-800">
                <div>
                  <p className="text-xs text-amber-200 font-semibold">{totalCartCount} item{totalCartCount > 1 ? 's' : ''} added</p>
                  <p className="text-lg font-black">{CURRENCY_SYMBOL}{totalCartPrice}</p>
                </div>
                <button
                  onClick={handlePlaceOrder}
                  disabled={orderPlacing}
                  className="px-6 py-3 bg-amber-500 hover:bg-amber-400 active:scale-95 text-stone-950 font-black text-sm rounded-xl transition shadow-md flex items-center gap-2"
                >
                  {orderPlacing ? (
                    <span>Placing...</span>
                  ) : (
                    <>
                      <span>Place Order</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}