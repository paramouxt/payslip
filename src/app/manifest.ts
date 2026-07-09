import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ShiftSync',
    short_name: 'ShiftSync',
    description: 'Payroll intelligence for shift workers.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#16181f',
    theme_color: '#16181f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
