'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { APP_NAME, CURRENCY_SYMBOL } from '@/lib/constants';
import { Session, Order, OrderItem, OrderStatus } from '@/lib/types';

interface DetailedOrder extends Order {
  order_items: OrderItem[];
}

export default function MyOrderPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [orders, setOrders] = useState<DetailedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = localStorage.getItem('brew_bite_session_id');
    if (!sessionId) {
      router.push('/order');
      return;
    }

    fetchSessionAndOrders(sessionId);

    const ordersChannel = supabase
      .channel('my_orders_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `session_id=eq.${sessionId}` },
        () => fetchSessionAndOrders(sessionId)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          if (payload.new.status === 'completed') {
            setSession(payload.new as Session);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
    };
  }, [router]);

  const fetchSessionAndOrders = async (sessionId: string) => {
    setErrorMsg(null);
    const { data: sessionData, error: sessionErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionErr) {
      console.error('Error fetching session:', sessionErr);
      setErrorMsg(`Failed to load session details: ${sessionErr.message}`);
    } else if (sessionData) {
      setSession(sessionData);
    }

    const { data: ordersData, error: ordersErr } = await supabase
      .from('orders')
      .select(`
        id,
        session_id,
        status,
        created_at,
        order_items ( id, order_id, item_name, price, quantity )
      `)
      .eq('session_id', sessionId)
      .order('id', { ascending: true });

    if (ordersErr) {
      console.error('Error fetching orders:', ordersErr);
      setErrorMsg(`Failed to load orders: ${ordersErr.message}`);
    } else if (ordersData) {
      setOrders(ordersData as DetailedOrder[]);
    }
    setLoading(false);
  };

  const handleStartNewSession = () => {
    localStorage.removeItem('brew_bite_session_id');
    router.push('/order');
  };

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'new':
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300">New</span>;
      case 'preparing':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-300 animate-pulse">Preparing...</span>;
      case 'served':
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300">Served ✓</span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (session?.status === 'completed') {
    return (
      <div className="min-h-screen max-w-md mx-auto bg-stone-50 p-6 flex flex-col items-center justify-center text-center space-y-6">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-4xl shadow-inner">
          ✓
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-stone-900">Thank You, Bill Paid!</h1>
          <p className="text-stone-600 text-sm">
            We hope you enjoyed your time at {APP_NAME}. Have a wonderful rest of your day!
          </p>
        </div>
        <button
          onClick={handleStartNewSession}
          className="w-full py-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-2xl shadow-lg transition active:scale-98"
        >
          Start New Order
        </button>
      </div>
    );
  }

  const runningTotal = orders.reduce((sum, order) => {
    const orderSum = order.order_items?.reduce((oSum, item) => oSum + item.price * item.quantity, 0) || 0;
    return sum + orderSum;
  }, 0);

  return (
    <div className="min-h-screen max-w-md mx-auto bg-stone-50 pb-20 border-x border-stone-200/60">
      <header className="bg-amber-900 text-amber-50 p-4 shadow-md flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg leading-tight">Mera Order</h1>
          <p className="text-xs text-amber-200">Table #{session?.table_id} • {session?.customer_name}</p>
        </div>
        <button
          onClick={() => router.push('/order')}
          className="bg-amber-700/80 hover:bg-amber-700 text-amber-100 text-xs font-semibold px-3 py-2 rounded-xl transition border border-amber-600/50"
        >
          + Add Items
        </button>
      </header>

      {errorMsg && (
        <div className="m-4 p-3 bg-rose-100 border border-rose-300 text-rose-800 text-sm rounded-xl">
          {errorMsg}
        </div>
      )}

      <div className="p-4 space-y-4">
        <div className="bg-white p-5 rounded-2xl border border-stone-200/80 shadow-sm space-y-2">
          <div className="flex justify-between items-center text-stone-500 text-xs font-bold uppercase tracking-wider">
            <span>Running Bill Total</span>
            <span className="text-emerald-600 font-semibold uppercase">● Active Session</span>
          </div>
          <div className="text-3xl font-black text-stone-900">
            {CURRENCY_SYMBOL}{runningTotal}
          </div>
          <p className="text-[11px] text-stone-400">Payment will be collected at table when finished.</p>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-stone-200/60 p-6 space-y-3">
            <span className="text-4xl">🍽️</span>
            <p className="font-bold text-stone-700">No orders placed yet</p>
            <button
              onClick={() => router.push('/order')}
              className="px-5 py-2.5 bg-amber-600 text-white font-bold text-xs rounded-xl shadow-md"
            >
              Browse Menu & Order
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wider px-1">Order History</h2>
            {orders.map((order, index) => {
              const orderTotal = order.order_items?.reduce((s, i) => s + i.price * i.quantity, 0) || 0;
              return (
                <div key={order.id} className="bg-white rounded-2xl border border-stone-200/80 p-4 shadow-sm space-y-3">
                  <div className="flex justify-between items-center border-b border-stone-100 pb-2">
                    <span className="font-bold text-xs text-stone-700">Order #{index + 1}</span>
                    {getStatusBadge(order.status)}
                  </div>

                  <div className="space-y-2">
                    {order.order_items?.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <span className="text-stone-800 font-medium">
                          {item.item_name} <span className="text-stone-400 font-bold">x{item.quantity}</span>
                        </span>
                        <span className="font-semibold text-stone-900">{CURRENCY_SYMBOL}{item.price * item.quantity}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-stone-100 pt-2 flex justify-between items-center text-xs font-bold text-stone-600">
                    <span>Subtotal</span>
                    <span>{CURRENCY_SYMBOL}{orderTotal}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}