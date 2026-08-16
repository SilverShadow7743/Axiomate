import 'server-only'
import { classifySecret, MIN_TOKEN_LENGTH, type SecretResult } from './secretRules'

/**
 * Reading a secret from the environment.
 *
 * All this adds to `./secretRules` is `process.env` — which is the half that cannot be tested
 * without arranging the environment, and the half that must never reach a client bundle.
 */

export { MIN_TOKEN_LENGTH }
export type { SecretResult }

export function readSecret(name: string, minLength = MIN_TOKEN_LENGTH): SecretResult {
  return classifySecret(name, process.env[name]?.trim(), minLength)
}

/** The value, or null. For callers that only need to know whether they have one. */
export function secretValue(name: string, minLength = MIN_TOKEN_LENGTH): string | null {
  const result = readSecret(name, minLength)
  return 'value' in result ? result.value : null
}

/** Why a secret is unusable, or null when it is fine. For an error a person has to act on. */
export function secretProblem(name: string, minLength = MIN_TOKEN_LENGTH): string | null {
  const result = readSecret(name, minLength)
  return 'problem' in result ? result.problem : null
}
