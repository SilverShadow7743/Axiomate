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
 * **This is not authentication.** Nothing here verifies anybody. There is no login, no
 * session, no token, no password, and no way for two people to be told apart. This resolves
 * *one configured operator* — the person running this deployment — so that the trail says
 * something true about a single-operator installation instead of something invented.
 *
 * It follows that this does not make the Permissions column implementable. Authorisation
 * needs a principal that has proved who it is; attribution only needs a name that was not
 * made up. Those are different problems and only the second one is solved here.
 *
 * When authentication does arrive — Entra ID is the intended source — this is the function
 * that learns to read the session, and nothing downstream moves, because everything
 * downstream already takes the result as a parameter. That is the whole point of the seam.
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
 * operator and the log it has been accumulating is genuinely theirs. Recording an anonymous
 * placeholder would make the existing trail less true, not more careful.
 */
export const DEFAULT_OPERATOR: Actor = { id: 'nishant.sekhar', name: 'Nishant Sekhar' }
