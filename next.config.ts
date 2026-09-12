import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * A self-contained server, because the instance this runs on is small.
   *
   * The alternative contract is `next start` beside a full production `node_modules`, which is
   * what `infra/app.bicep` documents at length. It works, and it means shipping a 709 MB
   * dependency tree to a Basic App Service plan on every deploy. Standalone traces only the
   * modules the server actually reaches and emits its own `server.js`.
   *
   * Three things it does not carry, which the deploy step has to place beside it:
   *
   *   `.next/static` and `public`  served rather than imported, so nothing traces them.
   *   `data/`                      `lib/data.ts` reads the seed through `process.cwd()` at
   *                                runtime, and file tracing cannot see a path assembled from
   *                                strings. Miss it and the app boots and then 500s on its
   *                                first render, which is the worst time to find out.
   *
   * Changing this changes the startup command with it — `node server.js`, not `npm run start`.
   * The two are a pair, and `infra/app.bicep` says so in the same terms.
   */
  output: 'standalone',

  /** The framework's name is not the caller's business. */
  poweredByHeader: false,

  /**
   * Security headers on every response (12 Sep 2026 audit, H1). Until this the origin sent
   * none: the app was framable — a tool that approves and sends client mail — HTTPS was a 301
   * rather than a browser-side commitment, and Google Fonts saw full record URLs.
   *
   * `frame-ancestors 'self'` / `SAMEORIGIN` rather than `'none'`: "Your inbox" renders an email
   * body in a sandboxed `srcdoc` iframe, and a srcdoc document inherits its embedder's policy,
   * so `'none'` would refuse the app's own frame. Same-origin framing is not the clickjacking
   * vector; another origin is, and that stays refused.
   *
   * Deliberately no `script-src`: Next's hydration is inline script, so a script policy needs a
   * per-request nonce from middleware — a separate change, owed, not smuggled in as a policy
   * that would break the first render. No `preload` on HSTS: a preload commitment binds the
   * apex, and this is a *.azurewebsites.net host.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
    ]
  },
}

export default nextConfig
