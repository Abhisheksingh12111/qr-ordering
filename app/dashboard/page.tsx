'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { APP_NAME, CURRENCY_SYMBOL } from '@/lib/constants';
import { Session, Order, OrderItem, MenuItem, CafeTable } from '@/lib/types';

interface DetailedOrder extends Order {
  order_items: OrderItem[];
}

interface SessionData {
  session: Session;
  orders: DetailedOrder[];
  total: number;
  timeFormatted: string;
}

export default function OwnerDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'main' | 'menu'>('main');
  const [sessionsData, setSessionsData] = useState<SessionData[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [todaySales, setTodaySales] = useState<number>(0);
  const [newOrderSessionIds, setNewOrderSessionIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const audioContextRef = useRef<AudioContext | null>(null);

  const playNotificationSound = () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.log('Audio playback prevented by browser policy');
    }
  };

  const fetchDashboardData = async () => {
    setErrorMsg(null);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // 1. Fetch ALL sessions created today
    const { data: allSessions, error: sessErr } = await supabase
      .from('sessions')
      .select('*')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false });

    if (sessErr) {
      console.error('Error fetching sessions:', sessErr);
      setErrorMsg(`Dashboard error: ${sessErr.message}`);
      setLoading(false);
      return;
    }

    if (allSessions && allSessions.length > 0) {
      const sessionIds = allSessions.map((s) => s.id);
      const { data: allOrders, error: ordErr } = await supabase
        .from('orders')
        .select(`
          id,
          session_id,
          status,
          created_at,
          order_items ( id, order_id, item_name, price, quantity )
        `)
        .in('session_id', sessionIds)
        .order('id', { ascending: true });

      if (ordErr) {
        console.error('Error fetching orders:', ordErr);
      }

      const compiled: SessionData[] = allSessions.map((session) => {
        const sOrders = (allOrders as DetailedOrder[] || []).filter(
          (o) => o.session_id === session.id
        );
        const total = sOrders.reduce((acc, order) => {
          const oSum = order.order_items?.reduce((s, item) => s + item.price * item.quantity, 0) || 0;
          return acc + oSum;
        }, 0);

        const dateObj = new Date(session.created_at);
        const timeFormatted = isNaN(dateObj.getTime())
          ? 'Recent'
          : dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        return {
          session,
          orders: sOrders,
          total,
          timeFormatted,
        };
      });

      setSessionsData(compiled);

      const currentNewOrderSessions = new Set<string>();
      (allOrders || []).forEach((o) => {
        if (o.status === 'new') {
          currentNewOrderSessions.add(o.session_id);
        }
      });
      setNewOrderSessionIds(currentNewOrderSessions);
    } else {
      setSessionsData([]);
    }

    // 2. Fetch Cafe Tables
    const { data: tablesData, error: tabErr } = await supabase
      .from('cafe_tables')
      .select('*')
      .order('number', { ascending: true });

    if (tabErr) {
      console.error('Error fetching tables:', tabErr);
    } else if (tablesData) {
      setTables(tablesData);
    }

    // 3. Fetch Menu Items
    const { data: menuData, error: menuErr } = await supabase
      .from('menu_items')
      .select('*')
      .order('id', { ascending: true });

    if (menuErr) {
      console.error('Error fetching menu:', menuErr);
    } else if (menuData) {
      setMenuItems(menuData);
    }

    // 4. Calculate Today's Sales from completed sessions created today
    const completedTodaySessions = (allSessions || []).filter((s) => s.status === 'completed');
    if (completedTodaySessions.length > 0) {
      const compSessionIds = completedTodaySessions.map((s) => s.id);
      const { data: compOrders } = await supabase
        .from('orders')
        .select(`order_items ( price, quantity )`)
        .in('session_id', compSessionIds);

      let sales = 0;
      (compOrders || []).forEach((ord: any) => {
        ord.order_items?.forEach((item: any) => {
          sales += item.price * item.quantity;
        });
      });
      setTodaySales(sales);
    } else {
      setTodaySales(0);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchDashboardData();

    const channel = supabase
      .channel('owner_dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          playNotificationSound();
        }
        fetchDashboardData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
        fetchDashboardData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cafe_tables' }, () => {
        fetchDashboardData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const toggleItemAvailability = async (itemId: number, currentStatus: boolean) => {
    const { error } = await supabase
      .from('menu_items')
      .update({ available: !currentStatus })
      .eq('id', itemId);

    if (error) {
      console.error('Error toggling menu item:', error);
    } else {
      setMenuItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, available: !currentStatus } : item))
      );
    }
  };

  const freeTablesCount = tables.filter((t) => t.status === 'free').length;
  const occupiedTablesCount = tables.filter((t) => t.status === 'occupied').length;
  const activeCustomersCount = sessionsData.filter((s) => s.session.status === 'active').length;

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans">
      <header className="bg-stone-900 text-white px-6 py-4 shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">☕</span>
          <div>
            <h1 className="text-xl font-black tracking-tight">{APP_NAME} Owner Dashboard</h1>
            <p className="text-xs text-stone-400 font-medium">Live Kitchen & Table Control Center</p>
          </div>
        </div>

        <div className="flex gap-2 bg-stone-800 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('main')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'main' ? 'bg-amber-600 text-white shadow' : 'text-stone-300 hover:text-white'
            }`}
          >
            📋 Main Dashboard
          </button>
          <button
            onClick={() => setActiveTab('menu')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'menu' ? 'bg-amber-600 text-white shadow' : 'text-stone-300 hover:text-white'
            }`}
          >
            🍴 Menu Management
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="m-4 p-3 bg-rose-100 border border-rose-300 text-rose-800 text-sm rounded-xl">
          {errorMsg}
        </div>
      )}

      {/* Top Stats Cards */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 shadow-sm">
        <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200/85">
          <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Active Customers</p>
          <p className="text-2xl font-black text-amber-950">{activeCustomersCount}</p>
        </div>

        <div className="bg-emerald-50/60 p-3.5 rounded-2xl border border-emerald-200/85">
          <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Free / Occupied Tables</p>
          <p className="text-2xl font-black text-emerald-950">
            {freeTablesCount} <span className="text-xs font-normal text-stone-500">Free</span> / {occupiedTablesCount} <span className="text-xs font-normal text-stone-500">Occupied</span>
          </p>
        </div>

        <div className="bg-blue-50/60 p-3.5 rounded-2xl border border-blue-200/85">
          <p className="text-[11px] font-bold text-blue-800 uppercase tracking-wider">Today's Completed Sales</p>
          <p className="text-2xl font-black text-blue-950">{CURRENCY_SYMBOL}{todaySales}</p>
        </div>

        <div className="bg-purple-50/60 p-3.5 rounded-2xl border border-purple-200/85">
          <p className="text-[11px] font-bold text-purple-800 uppercase tracking-wider">Realtime Status</p>
          <p className="text-sm font-bold text-emerald-600 flex items-center gap-1.5 mt-1">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping"></span> Live & Connected
          </p>
        </div>
      </div>

      {activeTab === 'main' ? (
        <div className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-stone-900">Today's Customers</h2>
            <span className="text-xs text-stone-500 font-semibold">{sessionsData.length} total customer(s)</span>
          </div>

          {loading ? (
            <div className="bg-white p-12 rounded-2xl border border-stone-200 flex justify-center items-center">
              <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : sessionsData.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-stone-200 text-center space-y-2">
              <span className="text-4xl">☕</span>
              <p className="font-bold text-stone-700">No customers today</p>
              <p className="text-xs text-stone-400">New customer orders will appear here automatically.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 text-xs font-bold uppercase tracking-wider">
                      <th className="py-3.5 px-6">Customer Name</th>
                      <th className="py-3.5 px-6">Table No</th>
                      <th className="py-3.5 px-6">Time</th>
                      <th className="py-3.5 px-6">Total Bill</th>
                      <th className="py-3.5 px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-sm">
                    {sessionsData.map(({ session, total, timeFormatted }) => {
                      const isActive = session.status === 'active';
                      const hasNew = isActive && newOrderSessionIds.has(session.id);

                      return (
                        <tr
                          key={session.id}
                          className="hover:bg-amber-50/50 transition cursor-pointer"
                          onClick={() => router.push(`/dashboard/customer/${session.id}`)}
                        >
                          <td className="py-4 px-6 font-bold text-stone-900 flex items-center gap-2">
                            <span className="hover:text-amber-700 underline underline-offset-2">{session.customer_name}</span>
                            {hasNew && (
                              <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded animate-bounce">
                                NEW ORDER
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-6 font-semibold text-stone-700">#{session.table_id}</td>
                          <td className="py-4 px-6 text-stone-500 text-xs font-medium">{timeFormatted}</td>
                          <td className="py-4 px-6 font-black text-stone-900">{CURRENCY_SYMBOL}{total}</td>
                          <td className="py-4 px-6">
                            {isActive ? (
                              <span className="bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
                                Active
                              </span>
                            ) : (
                              <span className="bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
                                Paid
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Menu Availability Toggle</h2>
              <p className="text-xs text-stone-500">Instantly hide or show items on customer menu.</p>
            </div>

            <div className="divide-y divide-stone-100">
              {menuItems.map((item) => (
                <div key={item.id} className="py-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded uppercase">
                      {item.category}
                    </span>
                    <h3 className="font-bold text-stone-800 mt-0.5">{item.name}</h3>
                    <p className="text-xs text-stone-500 font-semibold">{CURRENCY_SYMBOL}{item.price}</p>
                  </div>

                  <button
                    onClick={() => toggleItemAvailability(item.id, item.available)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                      item.available
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                        : 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'
                    }`}
                  >
                    {item.available ? '● Available' : '○ Out of Stock'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}