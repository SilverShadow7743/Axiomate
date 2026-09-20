import 'server-only'
import type { Actor } from './actor'

/**
 * Who the server believes is acting.
 *
 * ---------------------------------------------------------------------------
 * What this is
 *
 * The single place an actor is resolved, and the reason attribution is now trustworthy in a
 * way it was not before. The reducer used to read a module-level constant at forty-seven
 * sites, so every audited change in the system — client-side and server-side, in every
 * workspace — carried one hardcoded name. The actor is a parameter now, and this function is
 * where the server's value comes from.
 *
 * That matters more than it sounds, because of how the write path works. The browser applies
 * an action optimistically and the server replays *the same action* through *the same
 * reducer*. If the actor travelled inside the action, the client would be telling the server
 * who it was, and the server would be writing it down. Keeping the actor a parameter rather
 * than a field of `Action` makes that structurally impossible: there is no field to forge.
 * The client's own attribution is optimistic and local; what lands in the database is
 * whatever this function returned, on the server, for that request.
 *
 * ---------------------------------------------------------------------------
 * What this is NOT
 *
 * **This is not authentication, and still isn't, even now that authentication exists.**
 * Nothing here verifies anybody. This resolves *one configured operator* — the person running
 * a deployment that has not chosen an identity provider at all — so that the trail says
 * something true about that case instead of something invented.
 *
 * It follows that this does not make the Permissions column implementable on its own.
 * Authorisation needs a principal that has proved who it is; attribution only needs a name
 * that was not made up. Those are different problems.
 *
 * Entra ID authentication has since arrived, but not by changing this function the way this
 * comment once expected. `lib/principal.ts`'s `getSession()` sits above `currentActor` rather
 * than inside it, and calls this function in exactly one case: no identity provider is
 * configured at all. Where a provider *is* configured, a valid session returns a verified
 * principal, and an invalid or missing one returns an explicit "not signed in" — never this
 * function's operator, on purpose, so a deployment that chose Entra can never fall back to
 * running requests as someone nobody signed in as. Everything downstream still takes the
 * result as a parameter — that part of the seam held — but the function that learned to read
 * the session is `getSession`, not this one, and callers that need to know whether an actor is
 * verified must go there.
 */
export function currentActor(): Actor {
  const configured = process.env.AXIOMATE_OPERATOR?.trim()
  if (configured) return { id: configured, name: configured }
  return DEFAULT_OPERATOR
}

/**
 * The operator when nothing says otherwise.
 *
 * A real name rather than "Unknown" or "System", because this deployment does have one
 * operator and the trail it has been accumulating is genuinely theirs. Recording an anonymous
 * placeholder would make the existing history less true, not more careful.
 *
 * The cost of that choice, stated because it is not obvious: a *second* deployment that
 * forgets to set `AXIOMATE_OPERATOR` will attribute its entire trail to a person who has
 * never touched it. That is the wrong default the moment this runs anywhere but here, and it
 * is the first thing to revisit when it does — before authentication, not after, because a
 * misattributed trail is worse than an unattributed one.
 */
export const DEFAULT_OPERATOR: Actor = { id: 'nishant.sekhar', name: 'Nishant Sekhar' }
