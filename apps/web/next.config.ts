import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Rewrites are resolved at build time: the docker image bakes in the value passed as a
// build arg. The browser only ever talks to this origin (SPEC NFR-S3).
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so the standalone output includes workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@cv/shared'],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // The live PDF preview (AC-11.7) is the one response this origin may frame. The API sets
        // `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on it; should Next add its
        // own header to the proxied response, the later rule for the same key wins, so it is
        // `'self'` here too and never the `'none'` above.
        source: '/api/cvs/:id/pdf/preview',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
    ];
  },
};

export default nextConfig;
