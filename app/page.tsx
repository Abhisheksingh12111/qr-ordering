import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-amber-100/50 via-orange-50/30 to-amber-50/50">
      <div className="max-w-md w-full text-center space-y-8 bg-white p-8 rounded-3xl shadow-xl border border-amber-100">
        <div className="space-y-3">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-100 text-amber-800 text-3xl font-bold mb-2">
            ☕
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-stone-900">{APP_NAME}</h1>
          <p className="text-stone-600 font-medium">Digital Table Ordering & Live Kitchen Management</p>
        </div>

        <div className="space-y-4 pt-4">
          <Link
            href="/order"
            className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-amber-600 hover:bg-amber-700 active:scale-98 text-white text-lg font-bold rounded-2xl shadow-lg shadow-amber-600/20 transition-all duration-150"
          >
            <span>📱</span> Customer View (/order)
          </Link>

          <Link
            href="/dashboard"
            className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-stone-900 hover:bg-stone-800 active:scale-98 text-white text-lg font-bold rounded-2xl shadow-lg transition-all duration-150"
          >
            <span>📊</span> Owner Dashboard (/dashboard)
          </Link>
        </div>

        <p className="text-xs text-stone-400 font-medium">Powered by Next.js & Supabase Realtime</p>
      </div>
    </main>
  );
}