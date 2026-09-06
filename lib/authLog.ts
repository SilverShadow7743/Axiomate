/**
 * One log line per authentication or authorization refusal — the gap the industry-standard
 * review named (OWASP A09:2021 Security Logging and Monitoring Failures): every 401/403 across
 * the write and download routes returned silently, so repeated probing left no server-side
 * trace to alert on or correlate. Mirrors the one refusal this codebase already logs
 * (app/api/auth/callback/route.ts's `console.warn('[auth] sign-in failed:', message)`).
 *
 * Deliberately not a database write or an audit-trail entry: those are for state a person
 * changed, and a refusal changes nothing. This is operational logging, read by whoever watches
 * the deployment, not by anyone inside the product.
 */
export function logAuthRefusal(
  route: string,
  reason: string,
  actor?: { id?: string; name?: string } | null,
): void {
  const who = actor?.name ?? actor?.id ?? 'unresolved actor'
  console.warn(`[auth] refused: ${route} — ${who} — ${reason}`)
}
