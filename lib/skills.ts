/**
 * What people can do, how well, and how recently.
 *
 * Pure — no clock, no I/O. Every function is given the date it should reason about.
 *
 * ---------------------------------------------------------------------------
 * This closes one of three named gaps, not all of them
 *
 * `lib/capacity.ts` refuses to schedule anybody, and says why: *"an optimiser that reassigns
 * work on capacity grounds would be making delivery decisions from a model that cannot see
 * skill, client relationship, or who was on the call last week."*
 *
 * This adds **skill**. Client relationship and who-was-on-the-call are still absent, and they
 * are not incidental — the second is often the whole reason a particular consultant is the right
 * one. So `candidatesFor` below returns candidates and what it could not see, and deliberately
 * does **not** return a best person. Ranking implies the ranking is complete, and it is not.
 *
 * ---------------------------------------------------------------------------
 * Levels are named, not numbered
 *
 * A 1-to-5 scale invites averaging, and an average skill level across a team is a number with no
 * referent — three people at 3 is not the same capability as one at 5 and two at 2, and the mean
 * says it is. Named levels resist that, and each carries what it means so two people rating
 * themselves are answering the same question.
 *
 * ---------------------------------------------------------------------------
 * Where a level came from is part of the level
 *
 * `self` is somebody's own account of themselves. `assessed` is another person's judgement, with
 * their name on it. `certified` is an external body's. They are different claims and the product
 * already has this vocabulary — `ResourceProfile.source`, `intake.confidence` — for the same
 * reason: a figure and its provenance get separated the moment they can be.
 *
 * A self-rated Expert staffed onto a client's hardest problem is a decision somebody should make
 * knowing it was self-rated.
 *
 * ---------------------------------------------------------------------------
 * A level is a judgement about a named person, and the boundary splits on that
 *
 * `WorkspaceState` is serialised into the page payload, so every field here reaches every
 * signed-in browser unless something removes it. Two different things are recorded in one row:
 *
 *   - **that a person holds a skill** — a directory fact, and the useful half. "Who has touched
 *     the intercompany module" is a question anybody staffing anything needs to ask.
 *   - **how good somebody says they are, and who said it** — a performance judgement about a
 *     named colleague. "Aware, assessed, by Nishant Sekhar" is not directory data.
 *
 * So the redaction is per field, not per collection: without `skill.view`, `level`, `source`,
 * `assessedBy` and `note` are removed at the boundary and `withheld` is set, while the row
 * itself survives. Rates went the other way — the whole collection is withheld — because a rate
 * has no half that is safe to publish. This one does, and emptying it would throw away the
 * directory to protect the judgement.
 *
 * A person's own rows are never withheld from them. Being told your recorded level is a thing
 * you may not see would be a worse product than not recording it.
 */

export const SKILL_LEVELS = [
  { key: 'aware', label: 'Aware', what: 'Has seen it done and can follow along. Not chargeable on it alone.' },
  { key: 'working', label: 'Working', what: 'Can do ordinary tasks with review. The common level, and the one most people are.' },
  { key: 'practitioner', label: 'Practitioner', what: 'Can do it unsupervised and handle the awkward cases.' },
  { key: 'expert', label: 'Expert', what: 'Sets the approach, and is who the practitioners ask.' },
] as const

export type SkillLevel = (typeof SKILL_LEVELS)[number]['key']

/** Ordered weakest first, so "at least practitioner" is a comparison rather than a lookup table. */
export const SKILL_ORDER: SkillLevel[] = ['aware', 'working', 'practitioner', 'expert']

/** Who says so. See the module note — this is part of the claim, not metadata about it. */
export const SKILL_SOURCES = ['self', 'assessed', 'certified'] as const
export type SkillSource = (typeof SKILL_SOURCES)[number]

export function atLeast(have: SkillLevel, want: SkillLevel): boolean {
  return SKILL_ORDER.indexOf(have) >= SKILL_ORDER.indexOf(want)
}

export function levelLabel(level: SkillLevel): string {
  return SKILL_LEVELS.find((l) => l.key === level)?.label ?? level
}

export function sourceLabel(source: SkillSource): string {
  return source === 'self' ? 'self-rated' : source === 'assessed' ? 'assessed' : 'certified'
}

/**
 * One entry in the firm's skill catalogue.
 *
 * Lives in the `OperatingModel` document rather than in a table of its own: it is a firm's own
 * vocabulary, edited rarely, and every other vocabulary the firm owns — disciplines, work types,
 * responsibilities — is already there. The product ships **no** default skills, because a
 * consultancy's skill list is the one part of its operating model nobody else can write for it.
 */
export interface Skill {
  /** `skill-12`, minted from the durable model counter. */
  id: string
  name: string
  /** A grouping the firm chooses — "D365 Finance", "Integration", "Delivery". Free text. */
  category: string
  description: string
  deletedAt: string | null
}

export interface PersonSkill {
  id: string
  /** The DIRECTORY id, like `PersonRate.personId` — not a name. A skill survives a rename. */
  personId: string
  skillId: string
  /**
   * **Null means withheld, not unrated.**
   *
   * The same discipline as `valueAt` returning null for "not known then": an absent value that
   * could be mistaken for a low one is the mistake worth designing against. Stored rows always
   * carry a level; only the copy that crosses the boundary can have this removed, and `withheld`
   * says which happened.
   */
  level: SkillLevel | null
  source: SkillSource | null
  /** Who assessed it, when `source` is `assessed`. Their name is part of the claim. */
  assessedBy: string | null
  /**
   * When this was last actually used on a piece of work.
   *
   * Null means nobody has said. It is not an audit field — it is the difference between a skill
   * somebody has and a skill somebody had. A consultant who last touched a module four years ago
   * is not a current practitioner in it, and a staffing model that cannot tell those apart will
   * confidently propose the wrong person.
   *
   * Kept on the readable side of the redaction: *when* somebody last used a skill is a delivery
   * fact, and it is what makes the directory half worth having.
   */
  lastUsedOn: string | null
  note: string
  /** True on a row whose judgement fields were removed at the boundary. Never true in storage. */
  withheld: boolean
  recordedBy: string
  recordedAt: string
  deletedAt: string | null
}

/** How stale a skill is allowed to get before it is worth saying so. Eighteen months. */
export const STALE_AFTER_DAYS = 548

export interface Requirement {
  skillId: string
  /** The floor. Somebody above it qualifies; somebody below it does not. */
  level: SkillLevel
}

export interface Candidate {
  personId: string
  level: SkillLevel
  source: SkillSource
  lastUsedOn: string | null
  /** True when `lastUsedOn` is older than `STALE_AFTER_DAYS`, or absent. */
  stale: boolean
  /** Every requirement this person meets, of those asked for. */
  meets: string[]
  /** Requirements they do not meet, and why — for the person reading, not for a filter. */
  misses: { skillId: string; have: SkillLevel | null; want: SkillLevel }[]
}

export interface MatchResult {
  /** People meeting every requirement. Unordered — see `blind`. */
  qualified: Candidate[]
  /** People meeting some but not all. Reported, because the firm may have nobody better. */
  partial: Candidate[]
  /**
   * How many rows could not be read because their level was withheld at the boundary.
   *
   * Reported rather than silently skipped: a shortlist computed from a redacted payload is
   * shorter than the truth, and a reader who is not told that will read it as the truth.
   */
  unreadable: number
  /**
   * What this match could not take into account, in plain words.
   *
   * Returned rather than documented, so it can be shown next to the result. A list of names with
   * no caveat reads as an answer; the same list with this beside it reads as a shortlist.
   */
  blind: string[]
}

/**
 * Who could do this work, as far as recorded skill goes.
 *
 * **Returns candidates, never a recommendation.** There is no ranking and no best match, because
 * ranking would imply the ranking is complete. This model cannot see who the client already
 * trusts, who was on the call last week, who is about to go on leave, or what anybody costs —
 * and three of those routinely decide the staffing.
 *
 * Availability and cost are deliberately not consulted here even though both now exist. Joining
 * them would produce a single number that looks like an answer; keeping them separate means a
 * delivery lead sees "these five can do it" and "these two are free" as two facts they combine
 * themselves, which is the decision that is actually theirs.
 *
 * `skills` is taken so a retired catalogue entry stops producing candidates. Without it this
 * function cannot tell a live skill from a deleted one, and would go on matching against
 * something the firm has said it no longer tracks.
 */
export function candidatesFor(
  requirements: Requirement[],
  personSkills: PersonSkill[],
  skills: Skill[],
  on: string,
): MatchResult {
  const liveSkills = new Set(skills.filter((s) => !s.deletedAt).map((s) => s.id))
  const wanted = requirements.filter((r) => liveSkills.has(r.skillId))
  const live = personSkills.filter((p) => !p.deletedAt && liveSkills.has(p.skillId))
  const unreadable = live.filter((p) => p.withheld || p.level === null).length
  const readable = live.filter((p): p is PersonSkill & { level: SkillLevel } => p.level !== null && !p.withheld)

  const people = [...new Set(readable.map((p) => p.personId))]
  const qualified: Candidate[] = []
  const partial: Candidate[] = []

  for (const personId of people) {
    const mine = readable.filter((p) => p.personId === personId)
    const meets: string[] = []
    const misses: Candidate['misses'] = []
    let best: (PersonSkill & { level: SkillLevel }) | null = null

    for (const req of wanted) {
      const held = mine.find((m) => m.skillId === req.skillId) ?? null
      if (held && atLeast(held.level, req.level)) {
        meets.push(req.skillId)
        if (!best || SKILL_ORDER.indexOf(held.level) > SKILL_ORDER.indexOf(best.level)) best = held
      } else {
        misses.push({ skillId: req.skillId, have: held?.level ?? null, want: req.level })
      }
    }

    // `best` is set whenever anything was met, so this is the only exit for somebody who met
    // nothing. Written as a guard rather than relying on it, because the alternative is a
    // non-null assertion that would go on compiling if the loop above ever changed.
    if (!best) continue
    const candidate: Candidate = {
      personId,
      level: best.level,
      source: best.source ?? 'self',
      lastUsedOn: best.lastUsedOn,
      stale: isStale(best.lastUsedOn, on),
      meets,
      misses,
    }
    ;(misses.length ? partial : qualified).push(candidate)
  }

  return {
    qualified,
    partial,
    unreadable,
    blind: [
      'who the client already knows and trusts',
      'who was on the call last week',
      'availability over the period — recorded, and not joined in here on purpose',
      'cost and charge-out — recorded, and not joined in here on purpose',
    ],
  }
}

/** Whether a skill has gone quiet. Absent counts as stale: nobody has said it is current. */
export function isStale(lastUsedOn: string | null, on: string): boolean {
  if (!lastUsedOn) return true
  const days = (Date.parse(on) - Date.parse(lastUsedOn)) / 86_400_000
  return !Number.isFinite(days) || days > STALE_AFTER_DAYS
}

/** How a match reads, leading with the size of the shortlist and what it cannot see. */
export function describeMatch(m: MatchResult, nameOf: (personId: string) => string): string {
  const hidden = m.unreadable
    ? ` ${m.unreadable} recorded ${m.unreadable === 1 ? 'skill was' : 'skills were'} not readable at your access level, so this list is shorter than the truth.`
    : ''

  if (!m.qualified.length && !m.partial.length) {
    return `Nobody with a recorded skill matches this.${hidden} That is not the same as nobody being able to do it — most skills in most firms have never been written down.`
  }
  const full = m.qualified.length
    ? `${m.qualified.length} ${m.qualified.length === 1 ? 'person meets' : 'people meet'} every requirement (${m.qualified.map((c) => nameOf(c.personId)).join(', ')})`
    : 'Nobody meets every requirement'
  const some = m.partial.length ? `; ${m.partial.length} meet some of it` : ''
  const stale = [...m.qualified, ...m.partial].filter((c) => c.stale).length
  const staleNote = stale ? ` ${stale} of these have not used the skill recently, or nobody has said when.` : ''
  return `${full}${some}.${staleNote}${hidden} This is a shortlist, not a recommendation — it cannot see ${m.blind[0]} or ${m.blind[1]}.`
}

/**
 * Why this person-skill cannot be recorded, or null.
 *
 * `level` and `source` are both checked against their allowed values even though
 * `lib/actionShape.ts` checks them at the wire. This is the function the scenario harness drives
 * directly, and a pure rule that trusts a caller it cannot see is a rule that is only enforced
 * on one of the two paths into the reducer.
 */
export function checkPersonSkill(
  p: Pick<PersonSkill, 'level' | 'source' | 'assessedBy'>,
): string | null {
  if (!p.level || !SKILL_ORDER.includes(p.level)) return 'That is not a level this product knows.'
  if (!p.source || !SKILL_SOURCES.includes(p.source)) return 'A level needs to say who says so.'
  /*
   * An assessment without an assessor is an anonymous claim wearing the authority of a judgement.
   * Self and certified do not need one — the first names itself and the second names a body.
   */
  if (p.source === 'assessed' && !p.assessedBy?.trim()) {
    return 'An assessed level needs the name of whoever assessed it — an assessment nobody signed is a self-assessment with a better label.'
  }
  return null
}

/**
 * The copy of a person-skill that may leave the server for this reader.
 *
 * Called at the boundary, once, in `boot()`. Kept here beside the type it strips so the two
 * cannot drift: a field added to `PersonSkill` is a field somebody has to decide about, and
 * having that decision live in the same file as the field is the only version of this that
 * survives the next person to touch it.
 */
export function redactPersonSkill(p: PersonSkill, ownPersonId: string | null): PersonSkill {
  if (p.personId === ownPersonId) return p
  return {
    ...p,
    level: null,
    source: null,
    assessedBy: null,
    note: '',
    withheld: true,
  }
}
