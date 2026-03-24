import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Beefcake',
  description: 'Gym management for Nordic operators',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
