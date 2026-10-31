'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { APP_NAME, CURRENCY_SYMBOL } from '@/lib/constants';
import { Session, Order, OrderItem, OrderStatus } from '@/lib/types';

interface DetailedOrder extends Order {
  order_items: OrderItem[];
}

function CustomerDetailContent() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<Session | null>(null);
  const [orders, setOrders] = useState<DetailedOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = async () => {
    if (!sessionId) return;
    setErrorMsg(null);

    // 1. Fetch Session
    const { data: sessionData, error: sessErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessErr || !sessionData) {
      console.error('Error fetching session:', sessErr);
      setErrorMsg(`Failed to load session: ${sessErr?.message || 'Not found'}`);
      setLoading(false);
      return;
    }
    setSession(sessionData);

    // 2. Fetch Orders & Items
    const { data: ordersData, error: ordErr } = await supabase
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

    if (ordErr) {
      console.error('Error fetching orders:', ordErr);
    } else if (ordersData) {
      setOrders(ordersData as DetailedOrder[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel(`customer_detail_${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `session_id=eq.${sessionId}` },
        () => fetchData()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const updateOrderStatus = async (orderId: number, status: OrderStatus) => {
    const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
    if (error) console.error('Error updating order status:', error);
    fetchData();
  };

  const completeSession = async () => {
    if (!session) return;
    const { error: sessErr } = await supabase.from('sessions').update({ status: 'completed' }).eq('id', session.id);
    if (sessErr) {
      console.error('Error completing session:', sessErr);
      return;
    }
    const { error: tabErr } = await supabase.from('cafe_tables').update({ status: 'free' }).eq('id', session.table_id);
    if (tabErr) {
      console.error('Error freeing table:', tabErr);
    }
    fetchData();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100">
        <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-100 p-6 space-y-4">
        <p className="text-stone-700 font-bold">Session not found.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold"
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const isPaid = session.status === 'completed';
  const totalAmount = orders.reduce((sum, order) => {
    const orderSum = order.order_items?.reduce((oSum, item) => oSum + item.price * item.quantity, 0) || 0;
    return sum + orderSum;
  }, 0);

  const dateObj = new Date(session.created_at);
  const formattedTime = isNaN(dateObj.getTime())
    ? 'Recent'
    : dateObj.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans">
      <header className="bg-stone-900 text-white px-6 py-4 shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-xl text-xs font-bold transition flex items-center gap-1"
          >
            <span>←</span> Back to Dashboard
          </button>
          <div>
            <h1 className="text-lg font-black tracking-tight">{APP_NAME} Customer Detail</h1>
            <p className="text-xs text-stone-400 font-medium">Session Management</p>
          </div>
        </div>
      </header>

      {errorMsg && (
        <div className="m-4 p-3 bg-rose-100 border border-rose-300 text-rose-800 text-sm rounded-xl">
          {errorMsg}
        </div>
      )}

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
        <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="bg-amber-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
                Table #{session.table_id}
              </span>
              {isPaid ? (
                <span className="bg-emerald-600 text-white text-xs font-extrabold px-3 py-1 rounded-full shadow-sm">
                  Paid ✓
                </span>
              ) : (
                <span className="bg-amber-500 text-white text-xs font-extrabold px-3 py-1 rounded-full shadow-sm">
                  Active
                </span>
              )}
            </div>
            <h2 className="text-2xl font-black text-stone-900 mt-1">{session.customer_name}</h2>
            <p className="text-xs text-stone-500 font-medium">Started at: {formattedTime}</p>
          </div>

          {!isPaid && (
            <button
              onClick={completeSession}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm px-6 py-3 rounded-2xl transition shadow-lg flex items-center justify-center gap-2"
            >
              <span>✓</span> Complete (Payment Received)
            </button>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider px-1">Orders Placed ({orders.length})</h3>

          {orders.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-stone-200 text-center text-stone-400 text-sm">
              No orders placed in this session yet.
            </div>
          ) : (
            orders.map((order, idx) => {
              const orderTotal = order.order_items?.reduce((s, i) => s + i.price * i.quantity, 0) || 0;
              const orderTimeObj = new Date(order.created_at);
              const orderTimeFormatted = isNaN(orderTimeObj.getTime())
                ? ''
                : orderTimeObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

              return (
                <div key={order.id} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-stone-700">Order #{idx + 1}</span>
                      {orderTimeFormatted && (
                        <span className="text-xs text-stone-400 font-medium">({orderTimeFormatted})</span>
                      )}
                    </div>

                    {isPaid ? (
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-lg uppercase">
                        {order.status}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
                        <button
                          onClick={() => updateOrderStatus(order.id, 'new')}
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                            order.status === 'new' ? 'bg-amber-600 text-white shadow' : 'text-stone-600 hover:text-stone-900'
                          }`}
                        >
                          New
                        </button>
                        <button
                          onClick={() => updateOrderStatus(order.id, 'preparing')}
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                            order.status === 'preparing' ? 'bg-blue-600 text-white shadow' : 'text-stone-600 hover:text-stone-900'
                          }`}
                        >
                          Preparing
                        </button>
                        <button
                          onClick={() => updateOrderStatus(order.id, 'served')}
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                            order.status === 'served' ? 'bg-emerald-600 text-white shadow' : 'text-stone-600 hover:text-stone-900'
                          }`}
                        >
                          Served
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {order.order_items?.map((item) => (
                      <div key={item.id} className="flex justify-between items-center text-sm py-1 border-b border-stone-100 last:border-none">
                        <span className="text-stone-800 font-medium">
                          {item.item_name} <span className="text-amber-700 font-extrabold">x{item.quantity}</span>
                        </span>
                        <span className="font-bold text-stone-900">{CURRENCY_SYMBOL}{item.price * item.quantity}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-stone-100 pt-3 flex justify-between items-center text-xs font-bold text-stone-600">
                    <span>Order Subtotal</span>
                    <span>{CURRENCY_SYMBOL}{orderTotal}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm flex items-center justify-between">
          <span className="font-bold text-stone-600 uppercase tracking-wider text-sm">
            {isPaid ? 'Final Bill Total (Paid)' : 'Running Total'}
          </span>
          <span className="text-3xl font-black text-stone-900">{CURRENCY_SYMBOL}{totalAmount}</span>
        </div>
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50/40 gap-3">
          <div className="w-10 h-10 border-4 border-amber-700 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-amber-900 font-semibold text-sm">Loading customer session...</p>
        </div>
      }
    >
      <CustomerDetailContent />
    </Suspense>
  );
}