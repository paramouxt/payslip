import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/layout/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ShiftSync', template: '%s · ShiftSync' },
  description:
    'Payroll intelligence for shift workers: live rota tracking, expected pay, payslip reconciliation, and the evidence to prove mistakes.',
  applicationName: 'ShiftSync',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#16181f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
