import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dojo Ascendant',
  description:
    'You are a headmaster, not a fighter. Raise students to mastery and let them found branches of your school.',
};

export const viewport: Viewport = {
  themeColor: '#0b0b0c',
  // Mobile-first: the two-minute check-in is the atom of retention (GDD §1.3).
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
