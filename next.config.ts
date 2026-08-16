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
}

export default nextConfig
