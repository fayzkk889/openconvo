import type { Metadata } from 'next';
import './globals.css';
import { getSiteUrl } from '@/lib/site-url';

const siteUrl = getSiteUrl();
const siteDescription = 'An open-source AI workspace that makes verified free models more reliable with task presets, fallback routing, file context, search, and local-first control.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'OpenConvo - AI Chat Workspace',
  description: siteDescription,
  applicationName: 'OpenConvo',
  authors: [{ name: 'OpenConvo' }],
  creator: 'OpenConvo',
  publisher: 'OpenConvo',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'OpenConvo',
    title: 'OpenConvo - AI Chat Workspace',
    description: siteDescription,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
    alt: 'OpenConvo - reliable open-source AI workspace for free models',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenConvo - AI Chat Workspace',
    description: siteDescription,
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
