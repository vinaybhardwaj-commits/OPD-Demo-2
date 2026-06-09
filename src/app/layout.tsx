import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OPD Encounter App — Even Hospital',
  description:
    'Doctor-facing OPD encounter app for Even Hospital — recording, documentation, prescription, WhatsApp dispatch.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
