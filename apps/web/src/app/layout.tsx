import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ServiceWorkerProvider } from '../components/ServiceWorkerProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Accountant SaaS',
  description: 'Autonomous accounting system powered by AI',
  manifest: '/manifest.json',
  themeColor: '#0ea5e9',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ServiceWorkerProvider />
        {children}
      </body>
    </html>
  );
}
