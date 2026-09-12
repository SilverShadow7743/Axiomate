'use client'

/**
 * The last resort: reached only when the root layout itself fails to render, so nothing from
 * the app — no stylesheet, no theme script — can be assumed. Plain HTML, inline styles, one
 * button. See `app/error.tsx` for the ordinary case and the reasoning.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '48px 24px', color: '#1b242c', background: '#f3f5f7' }}>
        <main style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>Axiomate could not start this page.</h1>
          <p style={{ margin: '0 0 8px' }}>
            Nothing already saved is affected. Reloading usually clears this; if it does not, the
            message below is what to report.
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 13, color: '#4a5661', margin: '0 0 20px' }}>
            {error.message}
            {error.digest ? ` (ref ${error.digest})` : ''}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ font: 'inherit', padding: '8px 14px', borderRadius: 6, border: '1px solid #b9c2ca', background: '#fff', cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
