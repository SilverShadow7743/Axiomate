import { DEFAULT_GRANTS, type PermissionKey } from './access'
import { liveRoles, type OperatingModel } from './config'

/**
 * What this workspace can do, whether it is switched on, and whether anybody can actually use it.
 *
 * ---------------------------------------------------------------------------
 * Where the idea came from, and where it diverges
 *
 * Hive presents its product as an App Library: fifty-three named things, each with a one-line
 * description and an enabled state, grouped into workspace-wide and personal. It is the clearest
 * answer to "what is this product" that any tool of this kind gives, and Axiomate has grown
 * skills, documents, milestones, scope, timesheets, capacity, intake, agents, automation,
 * portfolio and my-work with no single screen that says so.
 *
 * The divergence is the part that matters. Hive's library answers "is this on". That is the
 * easier half, and on its own it is misleading here — because in this product a capability can be
 * on, fully built, rendering perfectly, and refused to every single person.
 *
 * That is not hypothetical. Scenario AC1 was written on a day when five permissions existed in
 * code and no stored role held any of them, so nobody could submit a timesheet, approve one, see
 * a rate, set one or decide a change request. Four features, all working, all unusable, and
 * nothing anywhere said so. `mergeModel` merges grants per role with STORED winning — correctly,
 * so a firm's customisation survives a deployment — and the consequence is that shipping a new
 * permission does nothing for a workspace that already exists.
 *
 * So every capability here reports two different things:
 *
 *   `enabled`  a switch somebody chose. Off means a decision was made.
 *   `usable`   whether any live role holds the permissions it needs. Off means nobody chose
 *              anything — it is a gap, and the screen names the missing grant.
 *
 * Those must never be collapsed into one indicator. "Off" and "broken" look identical from the
 * outside and want completely different responses.
 *
 * ---------------------------------------------------------------------------
 * Nothing here is a licence
 *
 * Hive's equivalents carry prices — Timesheets, Resourcing, Proofing and Advanced Dashboards are
 * add-ons at $5 a seat each, on top of a $12 plan. This list has no prices, no tiers and no
 * upsell, and the absence is deliberate rather than unfinished: it describes one firm's own
 * workspace to the people running it.
 */

export interface Capability {
  id: string
  name: string
  /** One line, in the terms somebody using it would recognise. */
  what: string
  /**
   * The permissions it cannot work without.
   *
   * Only the ones that would make the capability inert. `document.remove` is not listed under
   * documents, for instance — losing it narrows what people may do without making uploads stop.
   */
  needs: PermissionKey[]
  /** Where in configuration it is turned on or off, when it can be. */
  switchedAt: string | null
}

export interface CapabilityState {
  capability: Capability
  /** A decision somebody made. True when there is no switch — those are always on. */
  enabled: boolean
  /** Somebody can actually reach it: every permission it needs is held by at least one role. */
  usable: boolean
  /** Live roles holding every permission it needs, by label. */
  heldBy: string[]
  /** Permissions no live role holds. Non-empty means the capability is unreachable. */
  missing: PermissionKey[]
  /** Set when the shipped defaults grant something this workspace's stored roles do not. */
  lostInMerge: PermissionKey[]
}

/**
 * The catalogue.
 *
 * Written by hand rather than derived, because a capability is a thing a person recognises and
 * the code has no such concept — deriving this from module names would produce a list of files.
 * The cost is that it must be extended when something is built, which is why the count is
 * asserted in the scenario suite rather than left to be noticed.
 */
export const CAPABILITIES: Capability[] = [
  {
    id: 'work',
    name: 'Issues and delivery work',
    what: 'The register itself — raising work, editing it, assigning it and closing it against a transition graph.',
    needs: ['work.create', 'work.edit', 'work.close'],
    switchedAt: null,
  },
  {
    id: 'schedule',
    name: 'Dates and the timeline',
    what: 'Planned start and end on a record, dependencies between them, and the Gantt they draw.',
    needs: ['work.schedule', 'work.link'],
    switchedAt: null,
  },
  {
    id: 'evidence',
    name: 'Evidence',
    what: 'Attaching what proves a record — quoted text, links and snapshots — so a closure can be produced later.',
    needs: ['evidence.add'],
    switchedAt: null,
  },
  {
    id: 'documents',
    name: 'Documents',
    what: 'Real files, stored in the firm’s SharePoint library rather than described in a field.',
    needs: ['document.upload'],
    switchedAt: 'Configuration → Where documents are filed',
  },
  {
    id: 'time',
    name: 'Time recording',
    what: 'Hours logged against work, within a window that refuses dates too far back to be remembered.',
    needs: ['time.record'],
    switchedAt: null,
  },
  {
    id: 'timesheets',
    name: 'Timesheets',
    what: 'A week of hours presented for approval, frozen while it is being decided, and returnable with a reason.',
    needs: ['time.submit', 'time.approve'],
    switchedAt: null,
  },
  {
    id: 'rates',
    name: 'Rates',
    what: 'What people cost and are charged at. Withheld from the page payload entirely, not hidden on screen.',
    needs: ['rate.view'],
    switchedAt: null,
  },
  {
    id: 'capacity',
    name: 'Capacity and allocation',
    what: 'Who is committed to what, what leave comes off it, and what is left.',
    needs: ['capacity.allocate'],
    switchedAt: null,
  },
  {
    id: 'skills',
    name: 'Skills',
    what: 'What people can do and at what level, with who said so recorded beside the claim.',
    needs: ['skill.record'],
    switchedAt: null,
  },
  {
    id: 'estimation',
    name: 'Estimation',
    what: 'Complexity scored and hours proposed, then baselined — after which a change needs a reason.',
    needs: ['estimate.edit', 'estimate.agree'],
    switchedAt: null,
  },
  {
    id: 'commercial',
    name: 'Statements of work',
    what: 'The contract envelope: agreed effort, value, and what a project is delivered under.',
    needs: ['sow.edit'],
    switchedAt: null,
  },
  {
    id: 'scope',
    name: 'Scope',
    what: 'What a contract says it will deliver, line by line, agreed one at a time.',
    needs: ['scope.edit', 'scope.approve'],
    switchedAt: null,
  },
  {
    id: 'milestones',
    name: 'Milestones and billing',
    what: 'A payment schedule where delivery and acceptance are separate acts, and acceptance is what makes money owed.',
    needs: ['milestone.edit', 'milestone.accept'],
    switchedAt: null,
  },
  {
    id: 'changes',
    name: 'Change requests',
    what: 'A variation raised against a contract, out of the total until somebody with authority decides it.',
    needs: ['change.approve'],
    switchedAt: null,
  },
  {
    id: 'approvals',
    name: 'Approvals',
    what: 'A gate on a transition, where the asker can never be the decider.',
    needs: ['approval.request', 'approval.decide'],
    switchedAt: 'Configuration → Approvals',
  },
  {
    id: 'clientMail',
    name: 'Client mail',
    what: 'Replies sent as the engagement’s own mailbox, recorded on the record, threading back through intake.',
    // note.add as well: the flow IS send-and-record, and the endpoint refuses at the door
    // rather than sending mail whose record would be refused on every try.
    needs: ['mail.send', 'note.add'],
    switchedAt: null,
  },
  {
    id: 'clientBoundary',
    name: 'Client boundary',
    what: 'What a client may see is decided per record and enforced by withholding from the payload — internal seats hold the key, client seats never can.',
    needs: ['internal.view'],
    switchedAt: null,
  },
  {
    id: 'proofing',
    name: 'Proofing',
    what: 'A deliverable sent to named colleagues for approve or request-changes, pinned to the exact bytes reviewed.',
    // Both halves: asking rides on upload, answering has its own key. A role with one and
    // not the other can see reviews it cannot move, which the screen states rather than hides.
    needs: ['document.upload', 'document.review'],
    switchedAt: null,
  },
  {
    id: 'intake',
    name: 'Email intake',
    what: 'Messages to a watched mailbox filed as work, under a named part of the tree.',
    needs: ['work.create'],
    switchedAt: 'Configuration → Intake',
  },
  {
    id: 'automation',
    name: 'Automation',
    what: 'Rules that act on records without somebody driving them, attributed to the rule that acted.',
    needs: ['work.edit'],
    switchedAt: 'Configuration → Automation',
  },
  {
    id: 'agents',
    name: 'Agents',
    what: 'Assistants that propose rather than decide, each with a stated level of autonomy.',
    needs: ['work.edit'],
    switchedAt: 'Configuration → Agents',
  },
  {
    id: 'config',
    name: 'Configuration',
    what: 'Terminology, roles, work types, service levels, transitions, filing and routing.',
    needs: ['config.manage'],
    switchedAt: null,
  },
]

/**
 * Resolve every capability against this workspace's roles.
 *
 * Pure, and takes the model rather than the state: none of this depends on what work exists, and
 * a capability that reported itself unusable because the register happened to be empty would be
 * answering a different question.
 */
export function capabilityStates(model: OperatingModel, enabled: Record<string, boolean> = {}): CapabilityState[] {
  const roles = liveRoles(model)
  const grants = model.access?.grants ?? {}

  return CAPABILITIES.map((capability) => {
    const holders = roles.filter((r) => {
      const held = grants[r.id] ?? []
      return capability.needs.every((k) => held.includes(k))
    })

    const missing = capability.needs.filter(
      (k) => !roles.some((r) => (grants[r.id] ?? []).includes(k)),
    )

    /*
     * A permission the product ships to a role that this workspace's stored copy of that role
     * does not hold. That gap is invisible everywhere else — the model merged cleanly, the screen
     * renders, and the refusal only arrives when somebody tries.
     */
    const lostInMerge = capability.needs.filter((k) =>
      roles.some((r) => (DEFAULT_GRANTS[r.id] ?? []).includes(k) && !(grants[r.id] ?? []).includes(k)),
    )

    return {
      capability,
      enabled: enabled[capability.id] ?? true,
      usable: missing.length === 0,
      heldBy: holders.map((r) => r.label),
      missing,
      lostInMerge,
    }
  })
}

/**
 * One sentence over the whole list.
 *
 * Leads with what is broken rather than what exists, because a count of capabilities is a
 * marketing figure and a count of unreachable ones is a job.
 */
export function describeCapabilities(states: CapabilityState[]): string {
  const unusable = states.filter((s) => !s.usable)
  const drifted = states.filter((s) => s.usable && s.lostInMerge.length)

  if (!unusable.length && !drifted.length) {
    return `${states.length} capabilities, and every one of them is held by at least one role — so nothing here is built but unreachable.`
  }

  const parts: string[] = []
  if (unusable.length) {
    parts.push(
      `${unusable.length} ${unusable.length === 1 ? 'is' : 'are'} unreachable — no role holds what ${unusable.length === 1 ? 'it needs' : 'they need'}, so ${unusable.length === 1 ? 'it is' : 'they are'} built and refused to everybody`,
    )
  }
  if (drifted.length) {
    parts.push(
      `${drifted.length} ${drifted.length === 1 ? 'has' : 'have'} a permission the product ships that this workspace’s roles never picked up`,
    )
  }
  return `${states.length} capabilities. ${parts.join(', and ')}.`
}
