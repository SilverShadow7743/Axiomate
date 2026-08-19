import { addDays, daysBetween, minIso } from './dates'
import { issuesUnder } from './engagement'
import { apply, type Action, type WorkspaceState } from './workspace'
import type { Actor } from './actor'
import type { DependencyType, Severity } from './types'

/**
 * Blueprints: the shape of an engagement that already ran, stored so the next one starts
 * from it.
 *
 * ---------------------------------------------------------------------------
 * Offsets, never dates
 *
 * Every dated entry carries `startOffset` / `endOffset` in days from the ANCHOR — the earliest
 * planned date the source engagement had. Applying names one anchor date and every date is
 * computed from it. A template that stamps forty records all dated today is worse than
 * nothing; somebody re-dates forty rows and gives up halfway. That is the Hive behaviour this
 * module exists to refuse.
 *
 * ---------------------------------------------------------------------------
 * Derived, not authored — and pruned before stored
 *
 * `extractBlueprint` proposes from a real subtree; the screen shows the proposal and the
 * person unticks what is not repeatable. Nothing is stored unreviewed. Deliberately absent
 * from every entry: owners (people are per-engagement — a name baked in here is the
 * identity-join failure waiting to recur), statuses (everything applies at the entry state),
 * and anything commercial.
 *
 * ---------------------------------------------------------------------------
 * Applying is the same lever
 *
 * `applyBlueprint` mirrors `runRecurrences`: sequential ordinary actions through `apply`,
 * attributed to the person who clicked, refusals collected with the reducer's own words.
 * What applied stands, what refused is listed, nothing is half-written.
 */

export interface BlueprintEntry {
  /** Stable within the blueprint; never a workspace id. */
  id: string
  /** The STORED kind — 'module', whatever the terminology renders it as. */
  kind: 'project' | 'module' | 'issue'
  name: string
  /** Another entry's id, or null for the blueprint's roots (applied under the target). */
  parentEntryId: string | null
  type: string
  severity: Severity
  discipline: string
  /** Days from the anchor, or null when the source item carried no such date. */
  startOffset: number | null
  endOffset: number | null
}

export interface BlueprintLink {
  predecessorEntryId: string
  successorEntryId: string
  dependencyType: DependencyType
  lagDays: number
}

/** A fact about what happened, appended on success — the provenance the design asks for. */
export interface BlueprintApplication {
  at: string
  by: string
  /** The workspace id everything was created under. */
  targetId: string
  /** The blueprint version that was applied, so later corrections stay distinguishable. */
  version: number
}

export interface Blueprint {
  id: string
  name: string
  sourceEngagementId: string
  /** 1 at creation; bumped on structural edits only — see the reducer arm. */
  version: number
  entries: BlueprintEntry[]
  links: BlueprintLink[]
  applications: BlueprintApplication[]
}

export interface BlueprintProposal {
  entries: BlueprintEntry[]
  links: BlueprintLink[]
  /** The source's earliest planned date — day zero. Null when nothing was dated. */
  anchor: string | null
  /** How many source items were dated, for the screen's honesty sentence. */
  dated: number
}

/**
 * Propose a blueprint from a live subtree.
 *
 * Pure and total: an engagement with no dated items produces all-null offsets and a null
 * anchor, stated on screen rather than discovered. Deleted rows are excluded — an archived
 * corner of an engagement is history, not shape.
 */
export function extractBlueprint(state: WorkspaceState, engagementId: string): BlueprintProposal {
  /* ---- the structural subtree, breadth-first so parents precede children ---- */
  const nodes: { id: string; kind: string; name: string; parentId: string }[] = []
  let frontier = [engagementId]
  while (frontier.length) {
    const next: string[] = []
    for (const n of Object.values(state.nodes)) {
      if (n.deletedAt || !n.parentId) continue
      if (frontier.includes(n.parentId) && (n.kind === 'project' || n.kind === 'module')) {
        nodes.push({ id: n.id, kind: n.kind, name: n.name, parentId: n.parentId })
        next.push(n.id)
      }
    }
    frontier = next
  }

  const issues = issuesUnder(state, engagementId)

  /* ---- the anchor: earliest planned date anywhere in the subtree ---- */
  const anchor = minIso(issues.flatMap((i) => [i.plannedStart, i.plannedEnd]))
  /*
   * daysBetween is an INCLUSIVE span - same day counts 1 - because it measures durations.
   * An offset is a distance: same day is 0. The -1 is that conversion, and without it every
   * applied date lands one day late. Found by BP1, kept as a comment so it is not "fixed".
   */
  const offset = (d: string | null) => (anchor && d ? daysBetween(anchor, d) - 1 : null)

  const entryIdFor = new Map<string, string>()
  nodes.forEach((n, i) => entryIdFor.set(n.id, `E${i + 1}`))
  issues.forEach((iss, i) => entryIdFor.set(iss.id, `W${i + 1}`))

  const inBlueprint = (workspaceId: string) => entryIdFor.get(workspaceId) ?? null

  const entries: BlueprintEntry[] = [
    ...nodes.map(
      (n): BlueprintEntry => ({
        id: entryIdFor.get(n.id)!,
        kind: n.kind as 'project' | 'module',
        name: n.name,
        // The engagement itself is not an entry: applying targets a parent, and the subtree
        // roots (whatever sat directly under the engagement) become the applied roots.
        parentEntryId: n.parentId === engagementId ? null : inBlueprint(n.parentId),
        type: '',
        severity: 'Medium',
        discipline: '',
        startOffset: null,
        endOffset: null,
      }),
    ),
    ...issues.map(
      (iss): BlueprintEntry => ({
        id: entryIdFor.get(iss.id)!,
        kind: 'issue',
        name: iss.subject,
        parentEntryId: iss.parentId === engagementId ? null : inBlueprint(iss.parentId),
        type: iss.type,
        severity: iss.severity,
        discipline: iss.discipline,
        startOffset: offset(iss.plannedStart),
        endOffset: offset(iss.plannedEnd),
      }),
    ),
  ]

  /* ---- links where BOTH ends are inside the subtree ---- */
  const links: BlueprintLink[] = Object.values(state.dependencies)
    .filter((d) => inBlueprint(d.predecessorId) && inBlueprint(d.successorId))
    .map((d) => ({
      predecessorEntryId: inBlueprint(d.predecessorId)!,
      successorEntryId: inBlueprint(d.successorId)!,
      dependencyType: d.dependencyType,
      lagDays: d.lagDays,
    }))

  return {
    entries,
    links,
    anchor,
    dated: issues.filter((i) => i.plannedStart || i.plannedEnd).length,
  }
}

export interface BlueprintRun {
  state: WorkspaceState
  steps: { action: Action; before: WorkspaceState; after: WorkspaceState }[]
  refusals: { action: Action; entryName: string; error: string }[]
  /** Blueprint entry id → created workspace id. */
  mapping: Map<string, string>
}

/**
 * Apply a blueprint under a target, dated from an anchor.
 *
 * `keep` prunes: an entry outside it is skipped WITH its whole subtree — a parent nobody
 * wants brings nothing with it. Ordering is parents-before-children by construction: an
 * entry is applied only once its parent's mapping exists (or it is a root).
 *
 * Undated entries stay undated. `Unscheduled` is a first-class state, and inventing dates
 * for items the source never dated would be a guess rendered as a plan.
 */
export function applyBlueprint(
  state: WorkspaceState,
  blueprint: Blueprint,
  targetParentId: string,
  anchor: string,
  actor: Actor,
  keep: Set<string>,
  now: string,
): BlueprintRun {
  let current = state
  const steps: BlueprintRun['steps'] = []
  const refusals: BlueprintRun['refusals'] = []
  const mapping = new Map<string, string>()
  const skipped = new Set<string>()

  /* Depth-sort so parentEntryId is always resolved before its children come up. */
  const depth = (e: BlueprintEntry): number => {
    let d = 0
    let cur: BlueprintEntry | undefined = e
    while (cur?.parentEntryId) {
      d++
      cur = blueprint.entries.find((x) => x.id === cur!.parentEntryId)
    }
    return d
  }
  const ordered = [...blueprint.entries].sort((a, b) => depth(a) - depth(b))

  for (const entry of ordered) {
    /* Prune is subtree prune: a skipped or refused parent takes its children with it. */
    if (!keep.has(entry.id) || (entry.parentEntryId && skipped.has(entry.parentEntryId))) {
      skipped.add(entry.id)
      continue
    }
    const parentId = entry.parentEntryId ? mapping.get(entry.parentEntryId) : targetParentId
    if (!parentId) {
      skipped.add(entry.id)
      continue
    }

    const create: Action = {
      t: 'create',
      parentId,
      kind: entry.kind,
      draft:
        entry.kind === 'issue'
          ? {
              name: entry.name,
              description: `From blueprint “${blueprint.name}” v${blueprint.version}.`,
              type: entry.type,
              severity: entry.severity,
              discipline: entry.discipline,
              raisedBy: actor.name,
              status: 'Open',
            }
          : { name: entry.name },
      now,
    } as Action

    const before = current
    const result = apply(current, create, actor)
    if (result.error) {
      refusals.push({ action: create, entryName: entry.name, error: result.error })
      skipped.add(entry.id)
      continue
    }
    const newId =
      Object.keys(result.state.issues).find((id) => !before.issues[id]) ??
      Object.keys(result.state.nodes).find((id) => !before.nodes[id])
    steps.push({ action: create, before, after: result.state })
    current = result.state
    if (newId) mapping.set(entry.id, newId)

    /* Dates from the anchor, only where the source had them. */
    if (newId && entry.kind === 'issue' && entry.endOffset !== null) {
      const start = addDays(anchor, entry.startOffset ?? entry.endOffset)
      const end = addDays(anchor, entry.endOffset)
      const dates: Action = { t: 'setDates', id: newId, start, end, now } as Action
      const dated = apply(current, dates, actor)
      if (dated.error) {
        refusals.push({ action: dates, entryName: entry.name, error: dated.error })
      } else {
        steps.push({ action: dates, before: current, after: dated.state })
        current = dated.state
      }
    }
  }

  /* Links, only where both ends applied. */
  for (const link of blueprint.links) {
    const pred = mapping.get(link.predecessorEntryId)
    const succ = mapping.get(link.successorEntryId)
    if (!pred || !succ) continue
    const dep: Action = {
      t: 'addDependency',
      predecessorId: pred,
      successorId: succ,
      dependencyType: link.dependencyType,
      lagDays: link.lagDays,
      now,
    } as Action
    const linked = apply(current, dep, actor)
    if (linked.error) {
      refusals.push({ action: dep, entryName: `${link.predecessorEntryId}→${link.successorEntryId}`, error: linked.error })
    } else {
      steps.push({ action: dep, before: current, after: linked.state })
      current = linked.state
    }
  }

  return { state: current, steps, refusals, mapping }
}

/** One sentence for the blueprint card. */
export function describeBlueprint(bp: Blueprint): string {
  const items = bp.entries.filter((e) => e.kind === 'issue').length
  const tiers = bp.entries.length - items
  const dated = bp.entries.filter((e) => e.endOffset !== null).length
  const applied = bp.applications.length
  return `${bp.entries.length} entries — ${tiers} structural, ${items} work items, ${dated} carrying offsets, ${bp.links.length} dependencies. Version ${bp.version}, applied ${applied === 0 ? 'never' : applied === 1 ? 'once' : `${applied} times`}.`
}
