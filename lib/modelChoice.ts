/**
 * Which model an AI route may bill the firm for (12 Sep 2026 audit, M2).
 *
 * The assistant and chat routes took `modelId` from the request body and passed it to
 * Anthropic unexamined, so any signed-in person — or a stale browser mirror — chose what the
 * firm paid for. The registry in Configuration → Agent registry is where an administrator
 * decides that, per agent, and it is the only list this function trusts: a requested id is
 * honoured only if some agent is configured to use it, or it is the code default. Anything
 * else lands on the default — never on a refusal that would take the one live AI path down for
 * a typo, and never on the most expensive model by accident.
 *
 * Pure: takes the registry, returns a string. The routes load the operating model alone
 * (`loadModelOnly`) to get the registry; without a database there is no registry to trust and
 * only the default is honoured.
 */
export function resolveModelId(
  requested: unknown,
  agents: Record<string, { modelId?: string }> | undefined,
  fallback: string,
): string {
  const asked = typeof requested === 'string' ? requested.trim() : ''
  if (!asked || asked === fallback) return fallback
  const configured = new Set(
    Object.values(agents ?? {})
      .map((a) => a.modelId?.trim())
      .filter((m): m is string => Boolean(m)),
  )
  return configured.has(asked) ? asked : fallback
}
