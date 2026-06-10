import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  rewrites: async () => [
    {
      // Pipedrive forces private apps to callback at /API/v2/callback (uppercase)
      // but Next.js normalizes routes to lowercase
      source: '/API/v2/callback',
      destination: '/api/v2/callback',
    },
  ],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.sentry.io https://vercel.live https://*.vercel.app https://api.api4com.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            // Call recordings: served same-origin via /api/proxy/recording, but
            // also allow the API4COM hosts and blob: so the <audio> player isn't
            // blocked by the default-src fallback (media has no own directive).
            "media-src 'self' blob: data: https://*.api4com.com",
            "font-src 'self' data:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.apollo.io https://*.sentry.io https://*.stripe.com https://vercel.live https://*.vercel.app https://*.api4com.com wss://*.api4com.com",
            "frame-src 'self' https://js.stripe.com https://vercel.live",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
});
