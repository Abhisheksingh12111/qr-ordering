import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Brew & Bite - QR Ordering System',
  description: 'Fast, seamless table-ordering system for cafes & restaurants',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" style={{ colorScheme: 'light' }}>
      <body className="bg-amber-50/30 text-stone-800 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}