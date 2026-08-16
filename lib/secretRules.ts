/**
 * What counts as a secret, and what only looks like one.
 *
 * Separated from the module that reads the environment for the reason `seal` is separated from
 * `cookie`: a function that reaches into `process.env` can only be exercised by arranging
 * `process.env`, and the arrangement is usually what a test gets wrong. Here the value is an
 * argument, so the case that matters — an unresolved Key Vault reference, which is long enough
 * to pass any length check — can be driven directly.
 *
 * ---------------------------------------------------------------------------
 * The failure this exists to stop
 *
 * App Service resolves a Key Vault reference by *substitution*: a setting written as
 * `@Microsoft.KeyVault(VaultName=v;SecretName=s)` is replaced with the secret's value before
 * the process starts. When it cannot resolve one — the managed identity has no role yet, the
 * vault is unreachable, the secret was never written — it does not fail and it does not blank
 * the setting. It passes the reference through literally.
 *
 * The application then receives a seventy-character string. Every check asking "is this long
 * enough to be a secret" says yes, and the deployment comes up healthy while signing session
 * cookies with a value anybody can reconstruct from the vault name and the secret name, both of
 * which are in the infrastructure templates in this repository.
 *
 * It is not a rare state. The vault module needs the application's managed identity, so the
 * application is necessarily created first with its references already in place: every first
 * deployment starts here and stays until somebody writes the secrets and restarts.
 */

/** Providers that substitute a value in place, and the marker each leaves when it cannot. */
const UNRESOLVED_REFERENCE = /^@Microsoft\.(KeyVault|AppConfiguration)\(/i

/**
 * Values that are obviously stand-ins.
 *
 * Deliberately short. A long list of guesses would eventually refuse somebody's real secret,
 * and the length check already catches most of them — this is for the ones that are long
 * enough to pass it and were never meant to be used.
 */
const PLACEHOLDERS = /^(changeme|change-me|your[-_]?secret|placeholder|todo|xxx+|<[^>]*>)$/i

/** Tokens are compared for equality; the session key is a signing key and gets a higher floor. */
export const MIN_TOKEN_LENGTH = 16

export type SecretResult = { value: string } | { problem: string }

export function classifySecret(
  name: string,
  raw: string | undefined,
  minLength = MIN_TOKEN_LENGTH,
): SecretResult {

  if (!raw) return { problem: `${name} is not set.` }

  if (UNRESOLVED_REFERENCE.test(raw)) {
    return {
      problem: `${name} still holds an unresolved reference rather than a value. The vault could not be read — check that the application's managed identity has Key Vault Secrets User on it, that the secret exists, and restart. Until then this is refused rather than used, because the reference itself is long enough to pass for a secret and is published in the deployment templates.`,
    }
  }

  if (PLACEHOLDERS.test(raw)) {
    return { problem: `${name} is set to a placeholder rather than a secret.` }
  }

  if (raw.length < minLength) {
    return { problem: `${name} is shorter than ${minLength} characters.` }
  }

  return { value: raw }
}

