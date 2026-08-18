'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import {
  AGENT_FAMILIES,
  AUTONOMY_LABEL,
  LABEL_GROUPS,
  LABEL_KEYS,
  ROOT_SCOPE,
  kindLabel,
  liveResponsibilities,
  liveWorkTypes,
  liveDisciplines,
  liveRoles,
  liveSkills,
  skillName,
  resolveAgentEnabled,
  resolveLabel,
  resolveLabels,
  resolveRequired,
  resolveTemplate,
  type AgentFamily,
  type Autonomy,
  type DocumentFiling,
  type LabelKey,
  type ValueKind,
} from '@/lib/config'
import { capabilityStates, describeCapabilities } from '@/lib/capabilities'
import { kindOf, nameOf, scopeChainOf, type ConfigOp, type WorkspaceState } from '@/lib/workspace'
import { ISSUE_STATUSES, NODE_KINDS, type IssueStatus, type NodeKind } from '@/lib/types'
import type { Actor } from '@/lib/actor'
import { rateTimeline, type RateKind } from '@/lib/rates'
import { SKILL_LEVELS, isStale, levelLabel, sourceLabel, type SkillLevel, type SkillSource } from '@/lib/skills'
import { can, directoryPersonFor } from '@/lib/access'
import { isTerminal } from '@/lib/schedule'
import { PERMISSIONS, type PermissionKey } from '@/lib/access'
import { CONDITION_FIELDS, type ConditionField, type ConditionOp, type RuleActionKind } from '@/lib/automation'
import { EVENT_TYPES, type EventType } from '@/lib/events'
import { CHANNELS, type Channel } from '@/lib/notifications'
import { WATCH_CONDITIONS, observe, type ConditionKey } from '@/lib/watch'
import { bandForScore, bandProblems, totalComplexity, type SizeBand } from '@/lib/estimation'
import { useLabels } from './labels'

/**
 * The operating-model editor.
 *
 * Full page, like the issue editor, for the same reason: configuring how an organisation
 * describes and governs its work is a job in its own right, not something to squeeze into a
 * side panel next to the thing it is about to redefine.
 *
 * Two honesty rules run through every screen here:
 *
 *  1. Anything with no runtime says so, in place. The agent registry is a catalogue of
 *     decisions — what each agent is for, how far it may act, whether a person signs off — and
 *     exactly one entry currently executes. A settings page that renders the other thirty-seven
 *     identically would be claiming a system that does not exist.
 *
 *  2. Inherited values are shown as inherited, never silently pre-filled. An empty field that
 *     displays "inherits: Owner" is a field the user can leave alone; an empty field that has
 *     quietly been populated with "Owner" is one they will overwrite by accident.
 */

type Tab =
  | 'capabilities'
  | 'index'
  | 'terminology'
  | 'roles'
  | 'responsibilities'
  | 'agents'
  | 'workflows'
  | 'routing'
  | 'workTypes'
  | 'disciplines'
  | 'rates'
  | 'skills'
  | 'serviceLevels'
  | 'transitions'
  | 'permissions'
  | 'approvals'
  | 'automation'
  | 'watch'
  | 'sizing'
  | 'scopes'

const TABS: { id: Tab; label: string; group: string }[] = [
  { id: 'index', label: 'All settings', group: 'Operating model' },
  { id: 'capabilities', label: 'Capabilities', group: 'Operating model' },
  { id: 'terminology', label: 'Terminology', group: 'Operating model' },
  { id: 'roles', label: 'Roles & people', group: 'Operating model' },
  { id: 'workTypes', label: 'Work types', group: 'Operating model' },
  { id: 'disciplines', label: 'Disciplines', group: 'Operating model' },
  { id: 'rates', label: 'Rates', group: 'Governance' },
  { id: 'skills', label: 'Skills', group: 'Operating model' },
  { id: 'serviceLevels', label: 'Service levels', group: 'Operating model' },
  { id: 'transitions', label: 'Status transitions', group: 'Operating model' },
  { id: 'permissions', label: 'Permissions', group: 'Operating model' },
  { id: 'approvals', label: 'Approvals', group: 'Operating model' },
  { id: 'automation', label: 'Automation', group: 'Operating model' },
  { id: 'watch', label: 'Scheduled pass', group: 'Operating model' },
  { id: 'sizing', label: 'T-shirt sizing', group: 'Operating model' },
  { id: 'responsibilities', label: 'Responsibilities', group: 'Operating model' },
  { id: 'agents', label: 'Agent registry', group: 'Automation' },
  { id: 'workflows', label: 'Workflows & templates', group: 'Automation' },
  { id: 'routing', label: 'Routing & intake', group: 'Automation' },
  { id: 'scopes', label: 'Scope overrides', group: 'Governance' },
]

interface Props {
  state: WorkspaceState
  actor: Actor
  /** Whether this deployment verifies who somebody is, rather than taking their word. */
  signedIn: boolean
  onConfig: (op: ConfigOp) => boolean
  /**
   * Rates are records, not configuration, so they do not travel through `onConfig`.
   *
   * Keeping them off that path is not tidiness: `ConfigOp` is one action carrying a whole
   * operating model, and a cost rate has no business inside a payload that a `config.manage`
   * holder may send.
   */
  onRecordRate: (r: { personId: string; kind: RateKind; validFrom: string; validTo: string | null; amount: number; currency: string; reason: string }) => boolean
  onCorrectRate: (id: string, patch: { validFrom?: string; amount?: number }, reason: string) => boolean
  /**
   * Skill LEVELS are records too, and off the config path for a sharper reason than rates.
   *
   * The catalogue travels through `onConfig` because it is a vocabulary the firm owns. A level
   * is a judgement about a named colleague, and `config.manage` — which lets somebody rename a
   * work type — is not the authority that should carry one.
   */
  onRecordSkill: (r: { personId: string; skillId: string; level: SkillLevel; source: SkillSource; assessedBy: string | null; lastUsedOn: string | null; note: string }) => boolean
  onCorrectSkill: (id: string, patch: { level?: SkillLevel; source?: SkillSource; assessedBy?: string | null; lastUsedOn?: string | null; note?: string }) => boolean
  onRemoveSkill: (id: string) => boolean
  onClose: () => void
}

export default function ConfigWorkspace({ state, actor, signedIn, onConfig, onRecordRate, onCorrectRate, onRecordSkill, onCorrectSkill, onRemoveSkill, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('index')
  const [scopeId, setScopeId] = useState<string>(ROOT_SCOPE)
  const [confirmReset, setConfirmReset] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref)

  const model = state.model

  /**
   * Scopes a term can be redefined at.
   *
   * Only structural tiers, not issues: redefining what "Owner" means for one issue is a
   * distinction nobody can act on, and it would put 180 entries in this list.
   */
  const scopes = useMemo<ScopeOption[]>(() => {
    const tierNames = resolveLabels(model)
    const nodes = Object.values(state.nodes)
      .filter((n) => !n.deletedAt)
      .map((n) => ({ id: n.id, name: n.name, kind: n.kind, tier: kindLabel(tierNames, n.kind) }))
      // Coarse → fine, by the tier list itself. Sorting the kind alphabetically put Client
      // above Company and Module above Project, so the list read as a jumble of tiers rather
      // than as the delivery chain it is.
      .sort(
        (a, b) =>
          NODE_KINDS.indexOf(a.kind) - NODE_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name),
      )
    // ROOT carries no kind. It used to be handed a synthetic `organization` — a sixth tier
    // name that existed nowhere in the tree and kept an alias alive in `KIND_LABEL_KEY`.
    return [{ id: ROOT_SCOPE, name: 'Whole organisation', kind: null, tier: null }, ...nodes]
  }, [state.nodes, model])

  const chain = useMemo(
    () => (scopeId === ROOT_SCOPE ? [] : scopeChainOf(state, scopeId)),
    [state, scopeId],
  )

  const body = (
    <div className="cfg" ref={ref} role="dialog" aria-modal="true" aria-labelledby="cfg-title">
      <header className="cfg-head">
        <span className="cfg-title" id="cfg-title">
          Configuration
        </span>
        <span className="cfg-sub">Configure the operating model — do not hardcode it.</span>
        <span className="grow" />
        {/* Two-step, because it discards every term, role and rule in one go — but present,
            because a screen that can rename everything and offers no way back is one bad
            afternoon from being unusable. */}
        <button
          className={`btn${confirmReset ? ' danger-solid' : ''}`}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true)
              return
            }
            onConfig({ k: 'resetAll' })
            setConfirmReset(false)
          }}
          onBlur={() => setConfirmReset(false)}
          title="Discard all configuration and return to the shipped defaults. Issue data is not affected."
        >
          {confirmReset ? 'Confirm reset — this discards all configuration' : 'Reset to defaults'}
        </button>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </header>

      {/*
        * Said once, at the top, rather than twenty times.
        *
        * This workspace has twenty-one sections and — until today — exactly one of them
        * (Skills) asked whether the actor may configure anything. The other twenty rendered
        * live forms to everybody and refused at dispatch, which is the "opens, then refuses"
        * shape that Rates, Time, Capacity and Commercial deliberately avoid.
        *
        * Disabling twenty forms individually is the thorough fix and the wrong-sized one: it is
        * a large change to twenty components to restate a single fact that is true of all of
        * them. So the fact is stated once, up front, where it removes the surprise — and the
        * per-section gating that already exists keeps working underneath.
        *
        * The button that opens this is deliberately NOT hidden. Looking up what a work type or
        * a service level means is useful to everybody, and the one genuinely sensitive section
        * — Rates — is already absent from the rail without `rate.view`.
        */}
      {!can(state.model, actor, 'config.manage').allowed && (
        <p className="cfg-readonly" role="status">
          <strong>Read only.</strong>{' '}
          {can(state.model, actor, 'config.manage').reason ??
            'You do not hold the grant to change the operating model.'}{' '}
          You can look at anything here; saving will be refused.
        </p>
      )}

      <div className="cfg-body">
        <nav className="cfg-rail" aria-label="Configuration sections">
          {['Operating model', 'Automation', 'Governance'].map((group) => (
            <div key={group}>
              <div className="cfg-rail-group">{group}</div>
              {TABS.filter((t) => t.group === group)
                /*
                  * Absent, not empty. `boot()` strips rates from the payload for anybody without
                  * `rate.view`, so this tab would render an empty table and read as "no rates
                  * have been recorded" — which is a different statement from "you may not see
                  * them", and the wrong one.
                  */
                .filter((t) => t.id !== 'rates' || can(state.model, actor, 'rate.view').allowed)
                .map((t) => (
                <button
                  key={t.id}
                  className={`cfg-rail-item${tab === t.id ? ' on' : ''}`}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="cfg-panel">
          {tab === 'index' && <SettingsIndex state={state} go={setTab} />}
          {tab === 'capabilities' && <Capabilities state={state} />}
          {tab === 'terminology' && (
            <Terminology
              key={scopeId}
              state={state}
              scopeId={scopeId}
              setScopeId={setScopeId}
              scopes={scopes}
              chain={chain}
              onConfig={onConfig}
            />
          )}
          {tab === 'roles' && <RolesAndPeople state={state} onConfig={onConfig} />}
          {tab === 'responsibilities' && <Responsibilities state={state} onConfig={onConfig} />}
          {tab === 'agents' && <Agents state={state} onConfig={onConfig} />}
          {tab === 'workTypes' && <WorkTypes state={state} onConfig={onConfig} />}
          {tab === 'disciplines' && <Disciplines state={state} onConfig={onConfig} />}
          {tab === 'rates' && <Rates state={state} actor={actor} onRecord={onRecordRate} onCorrect={onCorrectRate} />}
          {tab === 'skills' && <Skills state={state} actor={actor} onConfig={onConfig} onRecord={onRecordSkill} onCorrect={onCorrectSkill} onRemove={onRemoveSkill} />}
          {tab === 'serviceLevels' && <ServiceLevels state={state} onConfig={onConfig} />}
          {tab === 'transitions' && <Transitions state={state} onConfig={onConfig} />}
          {tab === 'permissions' && <Permissions state={state} onConfig={onConfig} />}
          {tab === 'approvals' && <Approvals state={state} onConfig={onConfig} />}
          {tab === 'automation' && <Automation state={state} onConfig={onConfig} />}
          {tab === 'watch' && <Watch state={state} signedIn={signedIn} onConfig={onConfig} />}
          {tab === 'sizing' && <Sizing state={state} onConfig={onConfig} />}
          {tab === 'workflows' && <Workflows state={state} onConfig={onConfig} scopes={scopes} />}
          {tab === 'routing' && <Routing state={state} onConfig={onConfig} scopes={scopes} />}
          {tab === 'scopes' && (
            <Scopes
              state={state}
              scopeId={scopeId}
              setScopeId={setScopeId}
              scopes={scopes}
              chain={chain}
              onConfig={onConfig}
            />
          )}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}

/* ================================================================== *
 * Shared bits
 * ================================================================== */

interface ScopeOption {
  id: string
  name: string
  /** `null` for the organisation-wide default, which is not a tier of the tree. */
  kind: NodeKind | null
  /**
   * The configured name of that tier, resolved once at the organisation default.
   *
   * Carried on the option rather than resolved in the picker so the list stays stable: this
   * screen is where tiers get renamed, and a dropdown whose own entries shift scope as you
   * move through it would be reading its own edits back at you.
   */
  tier: string | null
}

function ScopeBar({
  scopeId,
  setScopeId,
  scopes,
  hint,
}: {
  scopeId: string
  setScopeId: (id: string) => void
  scopes: ScopeOption[]
  hint: string
}) {
  return (
    <div className="cfg-scope">
      <label htmlFor="cfg-scope-select">Editing for</label>
      <select
        id="cfg-scope-select"
        value={scopeId}
        onChange={(e) => setScopeId(e.target.value)}
      >
        {scopes.map((s) => (
          <option key={s.id} value={s.id}>
            {/* The configured term, not the internal kind: this screen is where "Process
                Area" gets renamed, so showing "(module)" here contradicted the very edit
                the user had just made. */}
            {s.tier ? `${s.name} (${s.tier})` : s.name}
          </option>
        ))}
      </select>
      <span className="cfg-scope-hint">{hint}</span>
    </div>
  )
}

function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`cfg-badge ${kind}`}>{children}</span>
}

/* ================================================================== *
 * Terminology
 * ================================================================== */

function Terminology({
  state,
  scopeId,
  setScopeId,
  scopes,
  chain,
  onConfig,
}: {
  state: WorkspaceState
  scopeId: string
  setScopeId: (id: string) => void
  scopes: ScopeOption[]
  chain: string[]
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  /** Local edits, so typing does not dispatch a reducer action per keystroke. */
  const [draft, setDraft] = useState<Record<string, string>>({})

  const overrideAt = (key: LabelKey) => model.overrides[scopeId]?.labels?.[key] ?? ''
  /** What this term would read as if the override here were removed. */
  const inheritedFor = (key: LabelKey) =>
    resolveLabel(model, key, chain.filter((c) => c !== scopeId))

  const commit = (key: LabelKey, value: string) => {
    if (value === overrideAt(key)) return
    onConfig({ k: 'setLabel', scopeId, key, label: value })
    setDraft((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
  }

  return (
    <>
      <ScopeBar
        scopeId={scopeId}
        setScopeId={setScopeId}
        scopes={scopes}
        hint={
          scopeId === ROOT_SCOPE
            ? 'The default for everything. Leave a field empty to use the shipped term.'
            : 'Only this branch of the tree. Leave a field empty to inherit from the level above.'
        }
      />

      <div className="cfg-section">
        <p className="cfg-note">
          Every term below has a permanent system key that code refers to, and a label that
          people read. Renaming the label changes every screen — the column heading, the filter,
          the form field, the dialog title and the words the assistant uses — and changes no
          stored record, so nothing in the History trail is rewritten.
        </p>
      </div>

      {LABEL_GROUPS.map((group) => (
        <section className="cfg-section" key={group.title}>
          <h3 className="cfg-h">{group.title}</h3>
          <p className="cfg-note">{group.note}</p>
          <div className="cfg-terms">
            {group.keys.map((key) => {
              const value = draft[key] ?? overrideAt(key)
              const inherited = inheritedFor(key)
              return (
                <div key={key} className="cfg-terms-row">
                  <code className="cfg-key">{key}</code>
                  <input
                    value={value}
                    placeholder={inherited}
                    aria-label={`Label for ${key}`}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    onBlur={(e) => commit(key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') {
                        setDraft((d) => {
                          const n = { ...d }
                          delete n[key]
                          return n
                        })
                      }
                    }}
                  />
                  <span className="cfg-inherit">
                    {overrideAt(key)
                      ? `overrides “${inherited}”`
                      : `inherits “${inherited}”${inherited === LABEL_KEYS[key] ? '' : ' (configured above)'}`}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}

/* ================================================================== *
 * Roles & people
 * ================================================================== */

function RolesAndPeople({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  const roles = liveRoles(model)
  const org = model.organization
  const filing = model.documentFiling
  const [newRole, setNewRole] = useState('')
  const [newParty, setNewParty] = useState('')
  const [personFilter, setPersonFilter] = useState('')
  const [newPerson, setNewPerson] = useState('')
  const [newPersonEmail, setNewPersonEmail] = useState('')

  const people = useMemo(() => {
    const all = Object.values(model.people).sort((a, b) => a.name.localeCompare(b.name))
    const q = personFilter.trim().toLowerCase()
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all
  }, [model.people, personFilter])

  return (
    <>
      <section className="cfg-section">
        <h3 className="cfg-h">This workspace</h3>
        <p className="cfg-note">
          The delivery organisation these engagements belong to. The top tier of the tree is a
          client <em>of</em> this organisation — without naming it, “{model.overrides.ROOT?.labels?.TIER_ORGANIZATION ?? 'Client'}”
          at the top of the tree has nothing to be a client of.
        </p>
        <div className="cfg-card">
          <div className="cfg-fld-row">
            <label className="cfg-fld">
              <span>Name</span>
              <input
                defaultValue={org.name}
                onBlur={(e) =>
                  e.target.value.trim() !== org.name &&
                  onConfig({ k: 'setOrganization', patch: { name: e.target.value } })
                }
              />
            </label>
            <label className="cfg-fld">
              <span>Short name</span>
              <input
                defaultValue={org.shortName}
                onBlur={(e) =>
                  e.target.value.trim() !== org.shortName &&
                  onConfig({ k: 'setOrganization', patch: { shortName: e.target.value } })
                }
              />
            </label>
            <label className="cfg-fld">
              <span>Accountable-party code</span>
              <input
                defaultValue={org.partyCode}
                onBlur={(e) =>
                  e.target.value.trim() !== org.partyCode &&
                  onConfig({ k: 'setOrganization', patch: { partyCode: e.target.value } })
                }
              />
            </label>
          </div>
          <p className="cfg-inherit">
            The party code is the value written onto issues this organisation is answerable
            for. It is stored data, not a label — it cannot be changed while issues carry it.
          </p>
        </div>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Where documents are filed</h3>
        <p className="cfg-note">
          The folder structure uploads are written into, inside the SharePoint library this
          deployment is pointed at. <em>Which</em> library is deployment configuration and is set
          with the infrastructure; where documents sit inside it is a filing convention, and every
          firm already has one.
        </p>
        <div className="cfg-card">
          <div className="cfg-fld-row">
            <label className="cfg-fld">
              <span>Top folder</span>
              <input
                defaultValue={filing.rootFolder}
                onBlur={(e) =>
                  e.target.value.trim() !== filing.rootFolder &&
                  onConfig({ k: 'setDocumentFiling', patch: { rootFolder: e.target.value } })
                }
              />
            </label>
          </div>
          <label className="cfg-check">
            <input
              type="checkbox"
              checked={filing.byEngagement}
              onChange={(e) =>
                onConfig({ k: 'setDocumentFiling', patch: { byEngagement: e.target.checked } })
              }
            />
            <span>
              <b>A folder per engagement or project.</b> The library then has the same shape as the
              tree. Turn it off and everything sits directly under the top folder — which is what a
              firm filing by year or by client instead would want.
            </span>
          </label>
          <p className="cfg-inherit">
            A document attached to something with no engagement or project above it is filed at the
            top rather than refused: where a file appears is presentation, and losing an upload over
            presentation would be the wrong trade.
          </p>
          <p className="cfg-inherit">
            Files go to <code>{filingExample(filing)}</code>. The tenant segment and the unique
            prefix on the name are not configurable — the first is the isolation rule the whole
            schema enforces, and the second is what stops re-uploading a filename silently
            replacing evidence.
          </p>
          <p className="cfg-inherit">
            Changing this moves nothing. Filing is applied when a document is stored, and every
            record points at its file by id rather than by path, so what is already in the library
            stays where it is and stays readable.
          </p>
        </div>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Organisation roles</h3>
        <p className="cfg-note">
          What people are, independent of any one project. Roles are what responsibility
          eligibility is expressed in terms of, so adding one here is what makes it selectable
          under Responsibilities.
        </p>

        {roles.map((r) => (
          <div className="cfg-card" key={r.id}>
            <div className="cfg-card-head">
              <input
                defaultValue={r.label}
                aria-label={`Name for ${r.id}`}
                onBlur={(e) =>
                  e.target.value.trim() !== r.label &&
                  onConfig({ k: 'upsertRole', id: r.id, label: e.target.value, description: r.description })
                }
              />
              <span className="grow" />
              {r.seeded && <Badge kind="seeded">built in</Badge>}
              {!r.seeded && (
                <button className="btn ghost" onClick={() => onConfig({ k: 'deleteRole', id: r.id })}>
                  Archive
                </button>
              )}
            </div>
            <code className="cfg-key">{r.id}</code>
            <p className="cfg-card-desc">{r.description}</p>
          </div>
        ))}

        <div className="cfg-inline">
          <input
            value={newRole}
            placeholder="Add a role — e.g. Solution Architect"
            aria-label="New role name"
            onChange={(e) => setNewRole(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!newRole.trim()}
            onClick={() => {
              if (onConfig({ k: 'upsertRole', id: null, label: newRole, description: '' })) setNewRole('')
            }}
          >
            Add role
          </button>
        </div>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Accountable parties</h3>
        <p className="cfg-note">
          The organisations that can be answerable for a piece of work. These are facts about
          who you work with, so they are configurable — unlike status and severity, which drive
          the schedule calculation and are fixed.
        </p>
        <div className="cfg-chips">
          {model.parties.map((p) => (
            <span className="cfg-chip" key={p}>
              {p}
              <button
                aria-label={`Remove ${p}`}
                onClick={() => onConfig({ k: 'setParties', parties: model.parties.filter((x) => x !== p) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="cfg-inline">
          <input
            value={newParty}
            placeholder="Add a party"
            aria-label="New accountable party"
            onChange={(e) => setNewParty(e.target.value)}
          />
          <button
            className="btn"
            disabled={!newParty.trim()}
            onClick={() => {
              if (onConfig({ k: 'setParties', parties: [...model.parties, newParty] })) setNewParty('')
            }}
          >
            Add
          </button>
        </div>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">People</h3>
        <p className="cfg-note">
          Seeded from the names already in the imported log, with no roles attached — the log
          records who worked an issue, never what they are. Eligibility rules apply only to
          people who have been given a role, so the directory tightens as it is filled in rather
          than blocking work while it is empty. Anyone the log never mentions — a joiner, or
          somebody who has yet to touch an issue — is added at the bottom of this list.
        </p>
        <div className="cfg-inline">
          <input
            value={personFilter}
            placeholder={`Filter ${Object.keys(model.people).length} people…`}
            aria-label="Filter people"
            onChange={(e) => setPersonFilter(e.target.value)}
          />
        </div>

        <table className="cfg-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Work address</th>
              <th>Roles</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {/* The field a signed-in person is matched on. Recorded here rather than
                      derived from a name, because two people can share a display name and one
                      person can change theirs. */}
                  <input
                    className="resp-input"
                    type="email"
                    defaultValue={p.email ?? ''}
                    placeholder="none recorded"
                    aria-label={`Work address for ${p.name}`}
                    onBlur={(e) => {
                      const next = e.target.value.trim()
                      if (next.toLowerCase() === (p.email ?? '').toLowerCase()) return
                      if (!onConfig({ k: 'upsertPerson', id: p.id, name: p.name, roleIds: p.roleIds, email: next })) {
                        e.target.value = p.email ?? ''
                      }
                    }}
                  />
                </td>
                <td>
                  <select
                    value=""
                    aria-label={`Add a role to ${p.name}`}
                    onChange={(e) => {
                      if (!e.target.value) return
                      onConfig({
                        k: 'upsertPerson',
                        id: p.id,
                        name: p.name,
                        roleIds: [...new Set([...p.roleIds, e.target.value])],
                      })
                    }}
                  >
                    <option value="">
                      {p.roleIds.length ? 'Add another…' : 'No role — add one…'}
                    </option>
                    {roles
                      .filter((r) => !p.roleIds.includes(r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                  </select>
                  <span className="cfg-chips">
                    {p.roleIds.map((rid) => (
                      <span className="cfg-chip" key={rid}>
                        {model.roles[rid]?.label ?? rid}
                        <button
                          aria-label={`Remove ${model.roles[rid]?.label ?? rid} from ${p.name}`}
                          onClick={() =>
                            onConfig({
                              k: 'upsertPerson',
                              id: p.id,
                              name: p.name,
                              roleIds: p.roleIds.filter((x) => x !== rid),
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </span>
                </td>
                <td className="cfg-inherit">{p.fromSource ? 'imported log' : 'entered here'}</td>
                <td>
                  {/*
                    * Removing somebody was a reducer arm with no control at all, so a person
                    * added by mistake — or a duplicate entry, which this directory has already
                    * produced once — could never be taken out.
                    *
                    * It does NOT cascade. Allocations, time and notifications key on the name,
                    * so removing a directory row leaves those pointing at somebody the workspace
                    * no longer knows. The title says so rather than the button pretending.
                    */}
                  <button
                    className="btn ghost"
                    title={`Remove ${p.name} from the directory. Anything already recorded against the name stays where it is.`}
                    onClick={() => onConfig({ k: 'deletePerson', id: p.id })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!people.length && <div className="cfg-empty">Nobody matches that filter.</div>}

        {/* The directory could only ever be read here, so the one column that already says
            "entered here" had no way of ever being true: every name had to arrive through the
            imported log, and a new joiner could not be given a role or be made assignable until
            they had worked an issue. `id: null` is what mints one — the same call the row
            fields make, with the same duplicate-name and duplicate-address checks, so nothing
            about validation lives out here.

            Name only, because a role is attached in the row above like everybody else's and
            duplicating that select would give two places to look. The address is offered
            because it is the field a signed-in person is matched on, and adding someone in
            order to sign them in is the case this exists for. */}
        <div className="cfg-inline">
          <input
            value={newPerson}
            placeholder="Add a person — full name"
            aria-label="New person's name"
            onChange={(e) => setNewPerson(e.target.value)}
          />
          <input
            type="email"
            value={newPersonEmail}
            placeholder="Work address — optional"
            aria-label="New person's work address"
            onChange={(e) => setNewPersonEmail(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!newPerson.trim()}
            onClick={() => {
              // Cleared only on success, so a refused name — one already in the directory, or
              // an address somebody else holds — is still in the box to correct rather than
              // retyped from memory. The reason itself arrives as a toast from the reducer.
              const email = newPersonEmail.trim()
              if (
                onConfig({
                  k: 'upsertPerson',
                  id: null,
                  name: newPerson,
                  roleIds: [],
                  ...(email ? { email } : {}),
                })
              ) {
                setNewPerson('')
                setNewPersonEmail('')
                // The list above is filtered, and a name that does not match the filter would
                // be added to a table it is not in — indistinguishable from nothing happening.
                setPersonFilter('')
              }
            }}
          >
            Add person
          </button>
        </div>
      </section>
    </>
  )
}


/* ================================================================== *
 * Disciplines
 * ================================================================== */

/**
 * Which discipline resolves a piece of work — the third classification axis.
 *
 * Separate from Work types on purpose, and the separation is the point: a Technical issue can be
 * a Defect or a Change Request, and folding the two lists together would make "the technical
 * defects" an unaskable question. See `Discipline` in lib/config.ts.
 *
 * `upsertDiscipline` and `deleteDiscipline` were reducer arms with no screen. This is the screen.
 */
function Disciplines({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  const disciplines = liveDisciplines(model)
  const roles = Object.values(model.roles).filter((r) => !r.deletedAt)
  const [added, setAdded] = useState('')

  /** How many records carry each — so archiving one is an informed decision, as with work types. */
  const counts = useMemo(() => {
    const n: Record<string, number> = {}
    for (const i of Object.values(state.issues)) {
      if (i.deletedAt || !i.discipline) continue
      n[i.discipline] = (n[i.discipline] ?? 0) + 1
    }
    return n
  }, [state.issues])

  const unclassified = useMemo(
    () => Object.values(state.issues).filter((i) => !i.deletedAt && !i.discipline).length,
    [state.issues],
  )

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Disciplines</h3>
      <p className="cfg-note">
        Who resolves a piece of work, as opposed to what kind of thing it is. A record carries a
        work type <em>and</em> a discipline <em>and</em> a process area, and the three vary
        independently — which is what makes &ldquo;the technical defects&rdquo; a question that
        can be asked.
      </p>
      <p className="cfg-note">
        The suggested owner is a proposal for routing, never an assignment. Nothing here sets an
        owner, and a discipline whose usual owner is on leave must not stop work being given to
        somebody else.
      </p>
      {unclassified > 0 && (
        <p className="cfg-note">
          {unclassified} live record{unclassified === 1 ? ' carries' : 's carry'} no discipline.
          That is the honest state of an imported log — nothing was guessed on their behalf.
        </p>
      )}

      {disciplines.map((d) => {
        const used = counts[d.id] ?? 0
        return (
          <div className="cfg-card" key={d.id}>
            <div className="cfg-card-head">
              <input
                defaultValue={d.label}
                aria-label={`Name for ${d.id}`}
                onBlur={(e) =>
                  e.target.value.trim() !== d.label &&
                  onConfig({ k: 'upsertDiscipline', id: d.id, label: e.target.value, description: d.description, ownerRoleId: d.ownerRoleId })
                }
              />
              <span className="cfg-key">{d.id}</span>
              {d.seeded && <Badge kind="seeded">standard</Badge>}
              <span className="cfg-inherit">{used === 1 ? '1 record' : `${used} records`}</span>
              <span className="grow" />
              <button
                className="btn ghost"
                disabled={d.seeded || used > 0}
                title={
                  d.seeded
                    ? 'One of the standard disciplines. It can be renamed, not removed.'
                    : used > 0
                      ? `${used} record${used === 1 ? ' is' : 's are'} in this discipline. Reclassify them first.`
                      : 'Archive this discipline'
                }
                onClick={() => onConfig({ k: 'deleteDiscipline', id: d.id })}
              >
                Archive
              </button>
            </div>
            <div className="cfg-row">
              <label className="fld">
                <span className="fld-label">Usually resolved by</span>
                <select
                  value={d.ownerRoleId}
                  onChange={(e) =>
                    onConfig({ k: 'upsertDiscipline', id: d.id, label: d.label, description: d.description, ownerRoleId: e.target.value })
                  }
                >
                  <option value="">Not settled</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <input
              defaultValue={d.description}
              placeholder="What this discipline covers — when somebody should choose it"
              aria-label={`Description for ${d.label}`}
              onBlur={(e) =>
                e.target.value.trim() !== d.description &&
                onConfig({ k: 'upsertDiscipline', id: d.id, label: d.label, description: e.target.value, ownerRoleId: d.ownerRoleId })
              }
            />
          </div>
        )
      })}

      <div className="cfg-add">
        <input
          value={added}
          placeholder="Add a discipline"
          aria-label="New discipline"
          onChange={(e) => setAdded(e.target.value)}
        />
        <button
          className="btn"
          disabled={!added.trim()}
          onClick={() => {
            if (onConfig({ k: 'upsertDiscipline', id: null, label: added, description: '', ownerRoleId: '' })) {
              setAdded('')
            }
          }}
        >
          Add
        </button>
      </div>
    </section>
  )
}

/* ================================================================== *
 * Work types
 * ================================================================== */

function WorkTypes({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  const types = liveWorkTypes(model)
  const [newType, setNewType] = useState('')

  /** How many records carry each type — so archiving one is an informed decision. */
  const counts = useMemo(() => {
    const n: Record<string, number> = {}
    for (const i of Object.values(state.issues)) {
      if (i.deletedAt) continue
      n[i.type] = (n[i.type] ?? 0) + 1
    }
    return n
  }, [state.issues])

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Work types</h3>
      <p className="cfg-note">
        What kind of work a record is. Every record lives in one table and is told apart by
        this — which is why adding a type here is configuration rather than a schema change,
        and why the imported log can carry Change Requests and Defects side by side.
      </p>
      <p className="cfg-note">
        The list started as whatever the imported records actually said they were, not as a
        standard taxonomy. Types marked <em>from the log</em> were discovered that way.
      </p>

      {types.map((t) => {
        const used = counts[t.label] ?? 0
        return (
          <div className="cfg-card" key={t.id}>
            <div className="cfg-card-head">
              <input
                defaultValue={t.label}
                aria-label={`Name for ${t.id}`}
                onBlur={(e) =>
                  e.target.value.trim() !== t.label &&
                  onConfig({ k: 'upsertWorkType', id: t.id, label: e.target.value, description: t.description })
                }
              />
              <span className="cfg-key">{t.id}</span>
              {t.fromSource && <Badge kind="seeded">from the log</Badge>}
              <span className="cfg-inherit">{used === 1 ? '1 record' : `${used} records`}</span>
              <span className="grow" />
              <button
                className="btn ghost"
                disabled={used > 0}
                title={
                  used > 0
                    ? `${used} record${used === 1 ? '' : 's'} are classified as this. Reclassify them first.`
                    : 'Archive this work type'
                }
                onClick={() => onConfig({ k: 'deleteWorkType', id: t.id })}
              >
                Archive
              </button>
            </div>
            <input
              defaultValue={t.description}
              placeholder="What this type is for — when someone should choose it"
              aria-label={`Description for ${t.label}`}
              onBlur={(e) =>
                e.target.value.trim() !== t.description &&
                onConfig({ k: 'upsertWorkType', id: t.id, label: t.label, description: e.target.value })
              }
            />
          </div>
        )
      })}

      <div className="cfg-inline">
        <input
          value={newType}
          placeholder="Add a work type — e.g. Risk, Decision, Deliverable"
          aria-label="New work type name"
          onChange={(e) => setNewType(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={!newType.trim()}
          onClick={() => {
            if (onConfig({ k: 'upsertWorkType', id: null, label: newType, description: '' })) setNewType('')
          }}
        >
          Add work type
        </button>
      </div>
    </section>
  )
}



/* ================================================================== *
 * Landing
 * ================================================================== */

/**
 * What is maintainable here, and what it currently says.
 *
 * The rail alone answers "where do I click" but not "what is there" — somebody opening this
 * screen to correct a work type or a service level had to visit nine sections to find out
 * which one owned it. Each card carries a live summary as well as a name, so the screen
 * doubles as a statement of the operating model rather than only a way into it: "Service
 * levels · High 5 / Medium 10 / Low 20" answers the question without a click.
 *
 * The counts are read from the model on every render rather than stored. A maintenance screen
 * reporting a stale figure is worse than one reporting none.
 */
function SettingsIndex({ state, go }: { state: WorkspaceState; go: (t: Tab) => void }) {
  const m = state.model
  const labels = useLabels()

  const cards: { id: Tab; title: string; what: string; now: string }[] = [
    {
      id: 'terminology',
      title: 'Terminology',
      what: 'What every tier, record and field is called on screen.',
      now: (() => {
        const n = Object.values(m.overrides).reduce(
          (acc, o) => acc + Object.keys(o.labels ?? {}).length,
          0,
        )
        return n ? `${n} term${n === 1 ? '' : 's'} renamed` : 'Shipped defaults'
      })(),
    },
    {
      id: 'roles',
      title: 'Roles & people',
      what: 'Who this firm is, the roles it recognises, and the directory of people.',
      now: `${liveRoles(m).length} roles · ${Object.values(m.people).length} people`,
    },
    {
      id: 'workTypes',
      title: 'Work types',
      what: 'What kind of work a record is. Adding one is configuration, not a schema change.',
      now: `${liveWorkTypes(m).length} types`,
    },
    {
      id: 'serviceLevels',
      title: 'Service levels',
      what: 'Working days allowed per severity. Drives targets, at-risk and overdue.',
      now: `High ${m.sla.High} / Medium ${m.sla.Medium} / Low ${m.sla.Low}`,
    },
    {
      id: 'sizing',
      title: 'T-shirt sizing',
      what: 'What a size is worth in story points and hours. Drives every estimate.',
      now: `${m.sizeBands.length} sizes · ${m.sizeBands[0]?.effortHours ?? '—'}–${m.sizeBands[m.sizeBands.length - 1]?.effortHours ?? '—'} h`,
    },
    {
      id: 'transitions',
      title: 'Status transitions',
      what: 'How work is allowed to move, and what a closure has to carry.',
      now: (() => {
        const p = m.statusPolicy
        const routes = Object.values(p.transitions).reduce((n, t) => n + t.length, 0)
        return p.enforced ? `Enforced · ${routes} routes` : 'Advisory — not applied'
      })(),
    },
    {
      id: 'permissions',
      title: 'Permissions',
      what: 'What each role may do. Enforced in the reducer, not only in the screens.',
      now: (() => {
        const a = m.access
        const withGrants = Object.values(a.grants).filter((g) => g.length).length
        return a.enforced ? `Enforced · ${withGrants} roles granted` : 'Advisory — not applied'
      })(),
    },
    {
      id: 'approvals',
      title: 'Approvals',
      what: 'Which moves need somebody to agree first, and who may agree.',
      now: (() => {
        const on = m.approvalRules.filter((r) => r.enabled).length
        return on ? `${on} in force` : 'None — nothing needs approval'
      })(),
    },
    {
      id: 'automation',
      title: 'Automation',
      what: 'What happens on its own when something changes.',
      now: (() => {
        const on = m.automationRules.filter((r) => r.enabled).length
        return on ? `${on} firing` : 'Nothing fires'
      })(),
    },
    {
      id: 'watch',
      title: 'Scheduled pass',
      what: 'What a clock notices when nobody is doing anything — overdue, at risk, over budget.',
      now: m.watch.enabled
        ? `${m.watch.conditions.length} conditions watched`
        : 'Off — nothing is noticed',
    },
    {
      id: 'responsibilities',
      title: 'Responsibilities',
      what: `Who must be named on a record — ${labels.ISSUE_OWNER}, ${labels.ISSUE_ACCOUNTABLE} and any you add.`,
      now: `${liveResponsibilities(m).length} types`,
    },
    {
      id: 'agents',
      title: 'Agent registry',
      what: 'What each agent is for, how far it may act, and whether a person signs off.',
      now: (() => {
        const all = Object.values(m.agents)
        const live = all.filter((a) => a.runtime === 'live').length
        return `${live} of ${all.length} implemented`
      })(),
    },
    {
      id: 'workflows',
      title: 'Workflows & templates',
      what: 'How work is meant to move, and the bundles that set a project up.',
      now: `${Object.values(m.workflows).length} workflows · ${Object.values(m.templates).length} templates`,
    },
    {
      id: 'routing',
      title: 'Routing & intake',
      what: 'Mailboxes work can arrive at, and the rules that classify it.',
      now: `${m.routingRules.length} rules · ${m.intake.length} mailboxes`,
    },
    {
      id: 'scopes',
      title: 'Scope overrides',
      what: 'Where a client, engagement or process area does things differently.',
      now: (() => {
        const n = Object.entries(m.overrides).filter(
          ([id, o]) =>
            id !== ROOT_SCOPE &&
            (Object.keys(o.labels ?? {}).length ||
              Object.keys(o.agentEnabled ?? {}).length ||
              Object.keys(o.responsibilityRequired ?? {}).length ||
              o.templateId),
        ).length
        return n ? `${n} scope${n === 1 ? '' : 's'} differ` : 'Everywhere the same'
      })(),
    },
  ]

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">All settings</h3>
      <p className="cfg-note">
        Everything the application reads instead of hardcoding. Each card says what it is for
        and what it currently says, so this screen answers most maintenance questions before
        anything is opened.
      </p>
      <div className="cfg-index">
        {cards.map((c) => (
          <button className="cfg-index-card" key={c.id} onClick={() => go(c.id)}>
            <span className="cfg-index-title">{c.title}</span>
            <span className="cfg-index-now">{c.now}</span>
            <span className="cfg-index-what">{c.what}</span>
          </button>
        ))}
      </div>
    </section>
  )
}


/* ================================================================== *
 * T-shirt sizing
 * ================================================================== */

function Sizing({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const bands = state.model.sizeBands
  const problems = bandProblems(bands)

  /** How many estimates currently land in each band — calibration is easier with usage. */
  const inUse = useMemo(() => {
    const n: Record<string, number> = {}
    for (const e of Object.values(state.estimates)) {
      const b = bandForScore(bands, totalComplexity(e.scores))
      if (b) n[b.size] = (n[b.size] ?? 0) + 1
    }
    return n
  }, [state.estimates, bands])

  const put = (size: string, patch: Partial<SizeBand>) =>
    onConfig({
      k: 'setSizeBands',
      bands: bands.map((b) => (b.size === size ? { ...b, ...patch } : b)),
    })

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">T-shirt sizing</h3>
      <p className="cfg-note">
        What a size is worth here. A complexity score between 5 and 25 lands in one of these
        bands, and the band carries the story points and the hours the estimate uses — so this
        is where the firm&rsquo;s calibration lives, rather than on the estimation screen.
      </p>
      <p className="cfg-note">
        Two firms running the same five-parameter model will disagree about what an L costs.
        These numbers are a starting point to be changed, not a recommendation.
      </p>

      {problems.length > 0 && (
        <div className="panel-note cfg-problem">
          {problems.map((x) => (
            <div key={x}>{x}</div>
          ))}
        </div>
      )}

      <table className="cfg-table est-table">
        <thead>
          <tr>
            <th>Size</th>
            <th>Score from</th>
            <th>to</th>
            <th>Story points</th>
            <th>Effort hours</th>
            <th>In use</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.size}>
              <td className="cfg-key">{b.size}</td>
              {(['minScore', 'maxScore', 'storyPoints', 'effortHours'] as const).map((f) => (
                <td key={f}>
                  <input
                    type="number"
                    min={0}
                    defaultValue={b[f]}
                    aria-label={`${b.size} ${f}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (!Number.isFinite(v) || v === b[f]) return
                      // Refused changes bounce the field back, so the table never shows a
                      // value the model rejected.
                      if (!put(b.size, { [f]: v })) e.target.value = String(b[f])
                    }}
                  />
                </td>
              ))}
              <td className="cfg-inherit">{inUse[b.size] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cfg-inherit">
        Bands must cover 5 to 25 without gaps or overlaps: a score with no size leaves an
        estimate with nothing to show, and a score in two bands makes the answer depend on
        which row happens to come first. A change that would break either is refused.
      </p>
    </section>
  )
}






/* ================================================================== *
 * Scheduled pass
 * ================================================================== */

function Watch({
  state,
  signedIn,
  onConfig,
}: {
  state: WorkspaceState
  signedIn: boolean
  onConfig: (op: ConfigOp) => boolean
}) {
  const policy = state.model.watch
  const [result, setResult] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  /** How many records each condition would raise if the pass ran right now, with no memory. */
  const preview = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const { findings } = observe(state, today, { ...policy, enabled: true })
    const counts: Record<string, number> = {}
    for (const f of findings) counts[f.condition] = (counts[f.condition] ?? 0) + 1
    return counts
  }, [state, policy])

  const toggle = (key: ConditionKey) =>
    onConfig({
      k: 'setWatch',
      patch: {
        conditions: policy.conditions.includes(key)
          ? policy.conditions.filter((c) => c !== key)
          : [...policy.conditions, key],
      },
    })

  const runNow = async () => {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/schedule/run', { method: 'POST' })
      const data = (await res.json()) as { ok: boolean; summary?: string; error?: string }
      setResult(data.ok ? data.summary ?? 'Done.' : (data.error ?? 'The run failed.'))
    } catch {
      setResult('Could not reach the server.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Scheduled pass</h3>
      <p className="cfg-note">
        Automation reacts to what people do. This is the other half: a pass that reads the clock
        and notices what became true while nobody was doing anything — a date that passed, a
        window that closed, a budget that ran out. Each of those becomes an ordinary event, and
        the rules on the Automation screen react to it exactly as they react to a click.
      </p>
      <p className="cfg-note">
        <b>It reports a condition once.</b> The pass remembers what it raised last time and
        compares, so an issue that has been overdue for six weeks is counted rather than
        announced every morning — and one that cleared and slipped again <em>is</em> announced,
        because that is a different fact from the first miss.
      </p>

      <div className="cfg-card">
        <label className="cfg-check">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(e) => onConfig({ k: 'setWatch', patch: { enabled: e.target.checked } })}
          />
          <span>
            <b>Run the pass.</b> Turning it off stops it noticing anything, and leaves its memory
            where it is — so switching it back on later does not raise a month of accumulated
            conditions at once.
          </span>
        </label>

        <div className="cfg-fld-row" style={{ marginTop: '10px' }}>
          <label className="cfg-fld">
            <span>Call work stale after</span>
            <input
              type="number"
              min={1}
              max={365}
              defaultValue={policy.staleAfterDays}
              onBlur={(e) => {
                const days = Number(e.target.value)
                if (days === policy.staleAfterDays) return
                if (!onConfig({ k: 'setWatch', patch: { staleAfterDays: days } })) {
                  e.target.value = String(policy.staleAfterDays)
                }
              }}
            />
          </label>
          <label className="cfg-fld">
            <span>Warn this many days before a date</span>
            <input
              type="number"
              min={0}
              max={60}
              defaultValue={policy.warnBeforeDays}
              onBlur={(e) => {
                const days = Number(e.target.value)
                if (days === policy.warnBeforeDays) return
                if (!onConfig({ k: 'setWatch', patch: { warnBeforeDays: days } })) {
                  e.target.value = String(policy.warnBeforeDays)
                }
              }}
            />
          </label>
        </div>
      </div>

      <h4 className="cfg-sub">What it looks for</h4>
      <table className="cfg-table">
        <thead>
          <tr>
            <th>Condition</th>
            <th>Watched</th>
            <th>True right now</th>
          </tr>
        </thead>
        <tbody>
          {WATCH_CONDITIONS.map((c) => (
            <tr key={c.key}>
              <td className="cfg-key">{c.label}</td>
              <td>
                <input
                  type="checkbox"
                  checked={policy.conditions.includes(c.key)}
                  aria-label={`Watch for ${c.label}`}
                  onChange={() => toggle(c.key)}
                />
              </td>
              <td className="mono">{preview[c.key] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cfg-inherit">
        The right-hand column is what is true today, not what would be raised. A first run
        against a workspace with history raises all of it at once, and every run after that only
        what is new — so run it once by hand before pointing a scheduler at it. Switching a
        single condition on later does <em>not</em> do that: its findings are recorded on the
        next run and raised from the one after, because announcing six months of accumulated
        staleness the moment somebody ticks a box is how a firm turns the whole thing off again.
      </p>

      <h4 className="cfg-sub">Running it</h4>
      <div className="cfg-card">
        <p className="cfg-note">
          Nothing in this application wakes itself up. Point whatever already runs things on a
          schedule at <code>POST /api/schedule/run</code>, with{' '}
          <code>Authorization: Bearer $AXIOMATE_SCHEDULE_TOKEN</code>. A timer inside the web
          server would stop when the process restarted, run twice when there were two instances,
          and could not be triggered by hand — which is what the button below does.
        </p>
        <div className="cfg-inline">
          <button className="btn" onClick={runNow} disabled={running}>
            {running ? 'Running…' : 'Run it now'}
          </button>
          {result && <span className="prov">{result}</span>}
        </div>
        <p className="cfg-inherit">
          A run by hand is attributed to the pass rather than to you: asking what the clock would
          say is not the same as deciding it, and your name on a week of overdue notices would
          say you had.
        </p>
        <p className="cfg-inherit">
          {signedIn
            ? 'You are signed in, so this button runs as you asking — the endpoint checks that you may configure the platform.'
            : 'This deployment has no identity provider, so the button runs without one — the same posture every other write takes here. Configure Entra and it starts requiring a signed-in operator or the token.'}
        </p>
      </div>
    </section>
  )
}

/* ================================================================== *
 * Automation
 * ================================================================== */

function Automation({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const rules = state.model.automationRules
  const roles = liveRoles(state.model)

  const put = (id: string, patch: Partial<(typeof rules)[number]>) =>
    onConfig({ k: 'setAutomationRules', rules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  /** What each rule has actually raised, so a rule nobody hears from is visible as such. */
  const fired = useMemo(() => {
    const n: Record<string, number> = {}
    for (const notification of Object.values(state.notifications)) {
      n[notification.ruleId] = (n[notification.ruleId] ?? 0) + 1
    }
    return n
  }, [state.notifications])

  const stuck = useMemo(
    () => Object.values(state.notifications).filter((n) => n.delivery !== 'delivered').length,
    [state.notifications],
  )

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Automation</h3>
      <p className="cfg-note">
        What happens on its own when something changes. A rule reacts to an event, checks a
        condition, and does something — and the something is dispatched as an ordinary action,
        through the same reducer a person&rsquo;s click goes through.
      </p>
      <p className="cfg-note">
        That is what makes it safe to switch on: <b>a rule cannot do anything a person could
        not.</b> It cannot close work with no evidence or move a record along a route the
        transition graph forbids, because the same code refuses it. Everything it does is in
        the audit trail with the rule that caused it.
      </p>

      {stuck > 0 && (
        <div className="panel-note warn">
          <b>{stuck} messages have not been sent.</b> Only the in-app inbox has a transport here
          — email and Teams are recorded and go nowhere. They are counted rather than hidden,
          because a rule that reaches nobody looks exactly like one that worked.
        </div>
      )}

      {rules.map((rule) => (
        <div className="cfg-card" key={rule.id}>
          <div className="cfg-fld-row">
            <label className="cfg-fld cfg-fld-wide">
              <span>Name</span>
              <input
                defaultValue={rule.label}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== rule.label) {
                    put(rule.id, { label: e.target.value.trim() })
                  }
                }}
              />
            </label>
            <label className="cfg-check">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => put(rule.id, { enabled: e.target.checked })}
              />
              <span>Firing</span>
            </label>
          </div>

          <div className="cfg-fld-row">
            <label className="cfg-fld">
              <span>When</span>
              <select value={rule.on} onChange={(e) => put(rule.id, { on: e.target.value as EventType })}>
                {EVENT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {rule.when.map((cond, i) => (
              <Fragment key={i}>
                <label className="cfg-fld">
                  <span>And</span>
                  <select
                    value={cond.field}
                    onChange={(e) =>
                      put(rule.id, {
                        when: rule.when.map((c, j) =>
                          j === i ? { ...c, field: e.target.value as ConditionField } : c,
                        ),
                      })
                    }
                  >
                    {CONDITION_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cfg-fld">
                  <span>&nbsp;</span>
                  <select
                    value={cond.op}
                    onChange={(e) =>
                      put(rule.id, {
                        when: rule.when.map((c, j) =>
                          j === i ? { ...c, op: e.target.value as ConditionOp } : c,
                        ),
                      })
                    }
                  >
                    {(['is', 'is not', 'is one of', 'is empty', 'is not empty'] as const).map((op) => (
                      <option key={op}>{op}</option>
                    ))}
                  </select>
                </label>
                <label className="cfg-fld">
                  <span>&nbsp;</span>
                  <input
                    defaultValue={cond.value}
                    placeholder="value"
                    onBlur={(e) =>
                      put(rule.id, {
                        when: rule.when.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)),
                      })
                    }
                  />
                </label>
              </Fragment>
            ))}
          </div>

          {rule.then.map((step, i) => (
            <div className="cfg-fld-row" key={i}>
              <label className="cfg-fld">
                <span>Then</span>
                <select
                  value={step.kind}
                  onChange={(e) =>
                    put(rule.id, {
                      then: rule.then.map((a, j) =>
                        j === i ? { ...a, kind: e.target.value as RuleActionKind } : a,
                      ),
                    })
                  }
                >
                  <option value="notify">Tell somebody</option>
                  <option value="setNextAction">Set the next action</option>
                  <option value="addNote">Add a note</option>
                  <option value="requestApproval">Ask for an approval</option>
                </select>
              </label>
              {step.kind === 'notify' && (
                <>
                  <label className="cfg-fld">
                    <span>Who</span>
                    <select
                      value={step.audience ?? 'owner'}
                      onChange={(e) =>
                        put(rule.id, {
                          then: rule.then.map((a, j) => (j === i ? { ...a, audience: e.target.value } : a)),
                        })
                      }
                    >
                      <option value="owner">The owner</option>
                      <option value="raisedBy">Whoever raised it</option>
                      {roles.map((r) => (
                        <option key={r.id} value={`role:${r.id}`}>
                          Everyone who is {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cfg-fld">
                    <span>How</span>
                    <select
                      value={step.channel ?? 'in-app'}
                      onChange={(e) =>
                        put(rule.id, {
                          then: rule.then.map((a, j) =>
                            j === i ? { ...a, channel: e.target.value as Channel } : a,
                          ),
                        })
                      }
                    >
                      {CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          {ch === 'in-app' ? 'In the app' : `${ch} — no transport`}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="cfg-fld cfg-fld-wide">
                <span>Saying</span>
                <input
                  defaultValue={step.text ?? ''}
                  placeholder="{id}, {subject}, {from}, {to} and {by} are filled in"
                  onBlur={(e) =>
                    put(rule.id, {
                      then: rule.then.map((a, j) => (j === i ? { ...a, text: e.target.value } : a)),
                    })
                  }
                />
              </label>
            </div>
          ))}

          <p className="cfg-inherit">
            {fired[rule.id]
              ? `Has raised ${fired[rule.id]} message${fired[rule.id] === 1 ? '' : 's'}.`
              : 'Has never fired here.'}
          </p>
        </div>
      ))}

      <p className="cfg-inherit">
        There is no schedule. Every rule reacts to something that happened, so &ldquo;every
        morning, escalate what is about to breach&rdquo; cannot be expressed — that needs a clock
        and a process to run it, and this application has neither. The SLA watch in the agent
        registry is exactly that shape, which is why it stays declared.
      </p>
    </section>
  )
}

/* ================================================================== *
 * Approvals
 * ================================================================== */

function Approvals({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const rules = state.model.approvalRules
  const roles = liveRoles(state.model)
  const types = liveWorkTypes(state.model)

  const put = (id: string, patch: Partial<(typeof rules)[number]>) =>
    onConfig({ k: 'setApprovalRules', rules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  /** How many live records each rule currently applies to — a rule about nothing is worth knowing. */
  const reach = useMemo(() => {
    const n: Record<string, number> = {}
    for (const rule of rules) {
      n[rule.id] = Object.values(state.issues).filter(
        (i) => !i.deletedAt && (!rule.workTypes.length || rule.workTypes.includes(i.type)),
      ).length
    }
    return n
  }, [rules, state.issues])

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Approvals</h3>
      <p className="cfg-note">
        A rule names a move and the roles that may allow it. Until somebody with one of those
        roles says yes, a record of the matching kind cannot make that move — the check rides on
        the same transition the status field already goes through, so there is one answer to
        &ldquo;may this record move&rdquo; rather than two that can disagree.
      </p>
      <p className="cfg-note">
        One rule has no switch here and never will: <b>the person who asks can never be the
        person who answers.</b> A self-approval is not a weaker control, it is the absence of
        one. A firm that wants a shorter path widens the roles instead.
      </p>

      {rules.map((rule) => (
        <div className="cfg-card" key={rule.id}>
          <div className="cfg-fld-row">
            <label className="cfg-fld cfg-fld-wide">
              <span>Name</span>
              <input
                defaultValue={rule.label}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== rule.label) put(rule.id, { label: e.target.value.trim() })
                }}
              />
            </label>
            <label className="cfg-fld">
              <span>Gates the move to</span>
              <select value={rule.status} onChange={(e) => put(rule.id, { status: e.target.value as IssueStatus })}>
                {ISSUE_STATUSES.map((st) => (
                  <option key={st}>{st}</option>
                ))}
              </select>
            </label>
            <label className="cfg-check">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => put(rule.id, { enabled: e.target.checked })}
              />
              <span>In force</span>
            </label>
          </div>

          <label className="cfg-fld cfg-fld-wide">
            <span>The question somebody is answering</span>
            <input
              defaultValue={rule.question}
              onBlur={(e) => {
                if (e.target.value !== rule.question) put(rule.id, { question: e.target.value })
              }}
            />
          </label>

          <div className="cfg-fld-row">
            <div className="cfg-fld cfg-fld-wide">
              <span>Applies to</span>
              <div className="cfg-chiprow">
                {types.map((t) => {
                  const on = rule.workTypes.includes(t.label)
                  return (
                    <label className="cfg-chip" key={t.id}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          put(rule.id, {
                            workTypes: on
                              ? rule.workTypes.filter((x) => x !== t.label)
                              : [...rule.workTypes, t.label],
                          })
                        }
                      />
                      <span>{t.label}</span>
                    </label>
                  )
                })}
              </div>
              <p className="cfg-inherit">
                {rule.workTypes.length
                  ? `${reach[rule.id] ?? 0} live records match.`
                  : `Every work type — all ${reach[rule.id] ?? 0} live records.`}
              </p>
            </div>

            <div className="cfg-fld cfg-fld-wide">
              <span>Decided by</span>
              <div className="cfg-chiprow">
                {roles.map((role) => {
                  const on = rule.deciderRoleIds.includes(role.id)
                  return (
                    <label className="cfg-chip" key={role.id}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          put(rule.id, {
                            deciderRoleIds: on
                              ? rule.deciderRoleIds.filter((x) => x !== role.id)
                              : [...rule.deciderRoleIds, role.id],
                          })
                        }
                      />
                      <span>{role.label}</span>
                    </label>
                  )
                })}
              </div>
              <p className="cfg-inherit">
                Holding the general grant is not enough on its own — a rule that names the client
                sponsor is not satisfied by a project manager who happens to be able to approve
                other things.
              </p>
            </div>
          </div>
        </div>
      ))}

      <p className="cfg-inherit">
        A rule with nobody able to decide it is refused rather than stored: it would be a wall,
        not a control, and the work it gates would never move again.
      </p>
      <p className="cfg-inherit">
        The shipped rule gates a change request <em>starting</em> rather than finishing. A change
        approved after delivery is a record of what was already done, which is the failure this
        exists to prevent. If no work type here is called Change Request, the rule matches
        nothing and blocks nothing.
      </p>
    </section>
  )
}

/* ================================================================== *
 * Permissions
 * ================================================================== */

function Permissions({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  const access = model.access
  const roles = liveRoles(model)

  /** How many people hold each role — a grant on a role nobody holds changes nothing today. */
  const holders = useMemo(() => {
    const n: Record<string, number> = {}
    for (const person of Object.values(model.people)) {
      for (const rid of person.roleIds) n[rid] = (n[rid] ?? 0) + 1
    }
    return n
  }, [model.people])

  const unassigned = useMemo(
    () => Object.values(model.people).filter((p) => !p.roleIds.length).length,
    [model.people],
  )

  const toggle = (roleId: string, key: PermissionKey) => {
    const current = access.grants[roleId] ?? []
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    onConfig({ k: 'setAccess', patch: { grants: { [roleId]: next } } })
  }

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Permissions</h3>
      <p className="cfg-note">
        What each role may do. Checked in the reducer — the one funnel every change passes
        through — so the rule holds for the grid, the forms, the assistant&rsquo;s applied
        proposals and anything that reaches the write endpoint, not only for the buttons.
      </p>

      <div className="panel-note warn">
        <b>Authorisation is enforced. Authentication is not.</b> There is still no login: every
        request resolves to one configured operator, so this stops a mistake rather than an
        attacker. Anyone who can set an environment variable can be whoever they like. The
        fallback role below is where that honesty is concentrated — on the day a login exists,
        it should be emptied and every real person should carry real roles.
      </div>

      <div className="cfg-card">
        <label className="cfg-check">
          <input
            type="checkbox"
            checked={access.enforced}
            onChange={(e) => onConfig({ k: 'setAccess', patch: { enforced: e.target.checked } })}
          />
          <span>
            <b>Apply these grants.</b> Turn it off and every actor may do everything — which is
            what this product did until the table existed.
          </span>
        </label>
        <div className="cfg-fld-row" style={{ marginTop: '10px' }}>
          <label className="cfg-fld">
            <span>Role for anyone with none of their own</span>
            <select
              value={access.defaultRoleIds[0] ?? ''}
              onChange={(e) =>
                onConfig({ k: 'setAccess', patch: { defaultRoleIds: e.target.value ? [e.target.value] : [] } })
              }
            >
              <option value="">Nothing — deny everything</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="cfg-inherit">
          {unassigned} of {Object.values(model.people).length} people in the directory hold no
          role. That is not an oversight in the data — the imported log records who worked an
          issue and never records what they are — so until roles are assigned, this fallback is
          what almost everyone gets.
        </p>
      </div>

      <div className="tablewrap">
        <table className="cfg-table perm-table">
          <thead>
            <tr>
              <th>Role</th>
              {PERMISSIONS.map((perm) => (
                <th key={perm.key} className="perm-col" title={perm.what}>
                  {perm.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td className="cfg-key">
                  {role.label}
                  <span className="cfg-inherit"> · {holders[role.id] ?? 0} people</span>
                </td>
                {PERMISSIONS.map((perm) => (
                  <td key={perm.key} className="perm-cell">
                    <input
                      type="checkbox"
                      checked={(access.grants[role.id] ?? []).includes(perm.key)}
                      aria-label={`${role.label} may ${perm.label}`}
                      onChange={() => toggle(role.id, perm.key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="cfg-inherit">
        A change that would leave nobody able to configure the platform is refused, because it
        would also leave nobody able to undo it — and this screen is the one it locks.
      </p>
      <p className="cfg-inherit">
        The client-side rows are the ones worth reading closely. They may raise work, say things
        about it and attach evidence; they may not close it, schedule it or estimate it. A client
        confirming a resolution is a status <em>the firm</em> moves the record into on their
        word — letting the client move it themselves would make that closure unfalsifiable.
      </p>
    </section>
  )
}

/* ================================================================== *
 * Status transitions
 * ================================================================== */

/**
 * One real path, built the way the store builds it.
 *
 * A described layout and an actual one drift, and the reader cannot tell which they are looking
 * at. This shows the shape with the parts that vary named in angle brackets and the parts that
 * do not shown literally.
 */
function filingExample(filing: DocumentFiling): string {
  const root = filing.rootFolder.trim() || 'Axiomate'
  return filing.byEngagement
    ? `${root}/<tenant>/<engagement>/<year>/<id>-name.pdf`
    : `${root}/<tenant>/<year>/<id>-name.pdf`
}

/**
 * What this workspace can do, and whether anybody can reach it.
 *
 * Read-only on purpose. Every switch it refers to already has a home elsewhere in configuration
 * and is named on the row; duplicating the controls here would create two places to change one
 * thing, which is how they come to disagree. This is an inventory, not a control panel.
 */
function Capabilities({ state }: { state: WorkspaceState }) {
  const states = useMemo(() => capabilityStates(state.model), [state.model])
  const broken = states.filter((c) => !c.usable)

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Capabilities</h3>
      <p className="cfg-note">{describeCapabilities(states)}</p>
      <p className="cfg-note">
        Two different things are reported per row, and they are deliberately not merged into one
        indicator. <b>Off</b> is a decision somebody made. <b>Unreachable</b> means no role holds
        the permissions it needs — nobody decided anything, the feature is built, and every
        attempt to use it is refused by a screen that renders perfectly. Those look identical from
        the outside and want completely different responses.
      </p>

      {broken.length > 0 && (
        <div className="cfg-card">
          <p className="zone-note needed">
            {broken.length === 1 ? 'One capability is' : `${broken.length} capabilities are`}{' '}
            unreachable. Grant the missing permission under <b>Permissions</b>, to a role somebody
            actually holds — adding it to a role nobody has changes nothing.
          </p>
        </div>
      )}

      {states.map((c) => (
        <div className="cfg-card" key={c.capability.id}>
          <div className="cfg-card-head">
            <b>{c.capability.name}</b>
            <span className="grow" />
            {c.usable ? (
              <Badge kind="seeded">
                {c.heldBy.length} {c.heldBy.length === 1 ? 'role' : 'roles'}
              </Badge>
            ) : (
              <Badge kind="p0">unreachable</Badge>
            )}
          </div>
          <p className="cfg-inherit">{c.capability.what}</p>

          {c.usable ? (
            <p className="cfg-inherit">Held by {c.heldBy.join(', ')}.</p>
          ) : (
            <p className="zone-note needed">
              No live role holds {c.missing.join(', ')}, so this is refused to everybody.
            </p>
          )}

          {c.lostInMerge.length > 0 && (
            <p className="zone-note needed">
              The product grants {c.lostInMerge.join(', ')} by default and this workspace’s
              stored roles do not have it. Stored configuration wins over shipped defaults —
              deliberately, so a firm’s changes survive a release — which means a permission
              added after this workspace was created never arrives on its own.
            </p>
          )}

          {c.capability.switchedAt && (
            <p className="cfg-inherit">Switched at {c.capability.switchedAt}.</p>
          )}
        </div>
      ))}
    </section>
  )
}

function Transitions({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const policy = state.model.statusPolicy
  const labels = useLabels()

  /** How many live records sit in each status — a route out of a busy one matters more. */
  const population = useMemo(() => {
    const n: Record<string, number> = {}
    for (const i of Object.values(state.issues)) {
      if (i.deletedAt) continue
      n[i.status] = (n[i.status] ?? 0) + 1
    }
    return n
  }, [state.issues])

  const toggle = (from: IssueStatus, to: IssueStatus) => {
    const current = policy.transitions[from] ?? []
    const next = current.includes(to) ? current.filter((s) => s !== to) : [...current, to]
    onConfig({ k: 'setStatusPolicy', patch: { transitions: { [from]: next } as Record<IssueStatus, IssueStatus[]> } })
  }

  const toggleList = (key: 'requireEvidence' | 'requireReason', status: IssueStatus) => {
    const current = policy[key]
    const next = current.includes(status)
      ? current.filter((s) => s !== status)
      : [...current, status]
    onConfig({ k: 'setStatusPolicy', patch: { [key]: next } })
  }

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Status transitions</h3>
      <p className="cfg-note">
        Which moves are allowed, and what a move has to carry. The {labels.FIELD_STATUS.toLowerCase()}{' '}
        vocabulary itself is fixed — progress is derived from it, so a status nobody had mapped
        would produce records with no percentage — but the route through it is a delivery
        process, and delivery processes differ between firms.
      </p>
      <p className="cfg-note">
        The graph governs <em>changes</em>, not history. Records imported from a client&rsquo;s log
        sit wherever that log left them, and none of them are made read-only by a rule written
        afterwards.
      </p>

      <div className="cfg-card">
        <label className="cfg-check">
          <input
            type="checkbox"
            checked={policy.enforced}
            onChange={(e) => onConfig({ k: 'setStatusPolicy', patch: { enforced: e.target.checked } })}
          />
          <span>
            <b>Apply this graph.</b> Turn it off and every move is allowed again. Worth saying
            plainly: an unenforced table describes a process and changes nothing, which is how
            this screen looked before the graph was applied at all.
          </span>
        </label>
      </div>

      <div className="tablewrap">
        <table className="cfg-table trans-table">
          <thead>
            <tr>
              <th>From ↓ &nbsp; To →</th>
              {ISSUE_STATUSES.map((s) => (
                <th key={s} className="trans-col">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ISSUE_STATUSES.map((from) => (
              <tr key={from}>
                <td className="cfg-key">
                  {from}
                  <span className="cfg-inherit"> · {population[from] ?? 0} live</span>
                </td>
                {ISSUE_STATUSES.map((to) => {
                  const same = from === to
                  const on = (policy.transitions[from] ?? []).includes(to)
                  return (
                    <td key={to} className={`trans-cell${same ? ' trans-self' : ''}`}>
                      {same ? (
                        <span aria-hidden="true">·</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Allow ${from} to ${to}`}
                          onChange={() => toggle(from, to)}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cfg-inherit">
        A change that would leave any status unable to reach a closure is refused: work would
        enter it and never leave, and whoever edited the table would find out weeks later from
        somebody who could not close a record.
      </p>

      <h4 className="cfg-sub">What a move has to carry</h4>
      <div className="cfg-card">
        <table className="cfg-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Needs evidence</th>
              <th>Needs a reason</th>
            </tr>
          </thead>
          <tbody>
            {ISSUE_STATUSES.map((s) => (
              <tr key={s}>
                <td className="cfg-key">{s}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={policy.requireEvidence.includes(s)}
                    aria-label={`${s} requires evidence`}
                    onChange={() => toggleList('requireEvidence', s)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={policy.requireReason.includes(s)}
                    aria-label={`${s} requires a reason`}
                    onChange={() => toggleList('requireReason', s)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cfg-inherit">
        Evidence is checked against the record at the moment of the move — a closure that
        claims the client confirmed it should have something behind it. A reason is kept on the
        audit entry rather than on the record, because it explains a change rather than
        describing the work.
      </p>
    </section>
  )
}

/* ================================================================== *
 * Service levels
 * ================================================================== */

function ServiceLevels({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const sla = state.model.sla
  const labels = useLabels()

  /** Open records already carrying a due date — the ones a change here will not move. */
  const alreadyDated = useMemo(
    () =>
      Object.values(state.issues).filter(
        (i) => !i.deletedAt && i.plannedEnd && !isTerminal(i.status),
      ).length,
    [state.issues],
  )

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Service levels</h3>
      <p className="cfg-note">
        How long each {labels.FIELD_SEVERITY.toLowerCase()} is allowed, in working days counted
        from the date a record was raised. These are commercial terms rather than a property of
        the software — they are negotiated, and they differ between firms — which is why they
        are configuration and not a constant.
      </p>
      <p className="cfg-note">
        They drive three things: the dashed target the timeline can preview, the window that
        makes a record read <em>At Risk</em> before it is late, and the dates that
        <em> Set due dates from this policy</em> writes.
      </p>

      <div className="cfg-card">
        <div className="cfg-fld-row">
          {(['High', 'Medium', 'Low'] as const).map((sev) => (
            <label className="cfg-fld" key={sev}>
              <span>{sev}</span>
              <input
                type="number"
                min={1}
                max={365}
                defaultValue={sla[sev]}
                aria-label={`Working days allowed for ${sev}`}
                onBlur={(e) => {
                  const days = Number(e.target.value)
                  if (days === sla[sev]) return
                  // The reducer validates too; this stops an obviously bad value from
                  // becoming an error toast when the field can simply refuse it.
                  if (!Number.isInteger(days) || days < 1 || days > 365) {
                    e.target.value = String(sla[sev])
                    return
                  }
                  if (!onConfig({ k: 'setSla', patch: { [sev]: days } })) {
                    e.target.value = String(sla[sev])
                  }
                }}
              />
            </label>
          ))}
        </div>
        <p className="cfg-inherit">
          Working days, so weekends are skipped when a target is calculated.
        </p>
      </div>

      {/* The thing somebody will otherwise discover by being surprised. */}
      <p className="cfg-note">
        <b>Changing these does not move dates that have already been set.</b> A due date on a
        record is a commitment somebody made, not a live calculation, so it stays where it is
        and keeps the reason that produced it.
        {alreadyDated > 0 && (
          <>
            {' '}
            {alreadyDated} open record{alreadyDated === 1 ? ' has' : 's have'} a due date today.
            New targets use the numbers above; those do not change unless you edit them.
          </>
        )}
      </p>
    </section>
  )
}

/* ================================================================== *
 * Responsibilities
 * ================================================================== */

function Responsibilities({
  state,
  onConfig,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  const roles = liveRoles(model)
  const types = liveResponsibilities(model)
  const [newLabel, setNewLabel] = useState('')

  return (
    <>
      <section className="cfg-section">
        <h3 className="cfg-h">Issue responsibility types</h3>
        <p className="cfg-note">
          Who has to be named on a piece of work, how many of them, and which roles are allowed
          to fill the slot. The three built-in types are bound to columns that already exist on
          every issue, so the grid, the filters, sorting and the assistant keep working on them;
          anything added here is stored alongside the issue and shown on its detail pane.
        </p>

        {types.map((t) => (
          <div className="cfg-card" key={t.id}>
            <div className="cfg-card-head">
              <input
                defaultValue={t.label}
                aria-label={`Name for ${t.id}`}
                onBlur={(e) =>
                  e.target.value.trim() !== t.label &&
                  onConfig({ k: 'upsertResponsibility', id: t.id, patch: { label: e.target.value } })
                }
              />
              <span className="grow" />
              {t.seeded && <Badge kind="seeded">built in</Badge>}
              {!t.seeded && (
                <button
                  className="btn ghost"
                  onClick={() => onConfig({ k: 'deleteResponsibility', id: t.id })}
                >
                  Archive
                </button>
              )}
            </div>
            <code className="cfg-key">{t.id}</code>
            <p className="cfg-card-desc">{t.description}</p>

            <div className="cfg-fld-row">
              <label className="cfg-fld">
                <span>Filled with</span>
                <select
                  value={t.valueKind}
                  disabled={t.seeded}
                  title={t.seeded ? 'Built-in types are bound to an existing column and cannot change type.' : undefined}
                  onChange={(e) =>
                    onConfig({
                      k: 'upsertResponsibility',
                      id: t.id,
                      patch: { valueKind: e.target.value as ValueKind },
                    })
                  }
                >
                  <option value="person">A person</option>
                  <option value="party">An organisation</option>
                  <option value="text">Free text</option>
                </select>
              </label>

              <label className="cfg-fld">
                <span>Minimum</span>
                <input
                  type="number"
                  min={0}
                  defaultValue={t.minCount}
                  onBlur={(e) =>
                    onConfig({
                      k: 'upsertResponsibility',
                      id: t.id,
                      patch: { minCount: Number(e.target.value) || 0 },
                    })
                  }
                />
              </label>

              <label className="cfg-fld">
                <span>Maximum</span>
                <input
                  type="number"
                  min={1}
                  placeholder="unlimited"
                  defaultValue={t.maxCount ?? ''}
                  onBlur={(e) =>
                    onConfig({
                      k: 'upsertResponsibility',
                      id: t.id,
                      patch: { maxCount: e.target.value === '' ? null : Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label className="cfg-fld">
                <span>Required</span>
                <select
                  value={t.required ? 'yes' : 'no'}
                  onChange={(e) =>
                    onConfig({
                      k: 'upsertResponsibility',
                      id: t.id,
                      patch: { required: e.target.value === 'yes' },
                    })
                  }
                >
                  <option value="no">Optional</option>
                  <option value="yes">Required</option>
                </select>
              </label>
            </div>

            <label className="cfg-fld">
              <span>Eligible roles</span>
              <div className="cfg-chips">
                {roles.map((r) => {
                  const on = t.eligibleRoleIds.includes(r.id)
                  return (
                    <button
                      key={r.id}
                      className={`cfg-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        onConfig({
                          k: 'upsertResponsibility',
                          id: t.id,
                          patch: {
                            eligibleRoleIds: on
                              ? t.eligibleRoleIds.filter((x) => x !== r.id)
                              : [...t.eligibleRoleIds, r.id],
                          },
                        })
                      }
                    >
                      {r.label}
                    </button>
                  )
                })}
              </div>
            </label>
            <p className="cfg-inherit">
              {t.eligibleRoleIds.length
                ? 'Checked only for people who have been given a role; anyone without one is still allowed.'
                : 'Anyone may be named.'}
            </p>
          </div>
        ))}

        <div className="cfg-inline">
          <input
            value={newLabel}
            placeholder="Add a responsibility — e.g. Technical Reviewer"
            aria-label="New responsibility name"
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!newLabel.trim()}
            onClick={() => {
              if (
                onConfig({
                  k: 'upsertResponsibility',
                  id: null,
                  patch: { label: newLabel, valueKind: 'person', minCount: 0, maxCount: 1 },
                })
              )
                setNewLabel('')
            }}
          >
            Add
          </button>
        </div>
      </section>
    </>
  )
}

/* ================================================================== *
 * Agents
 * ================================================================== */

const AUTONOMY_ORDER: Autonomy[] = ['off', 'suggest', 'propose', 'act']

function Agents({ state, onConfig }: { state: WorkspaceState; onConfig: (op: ConfigOp) => boolean }) {
  const model = state.model
  const agents = Object.values(model.agents)
  const live = agents.filter((a) => a.runtime === 'live')

  return (
    <>
      <section className="cfg-section">
        <h3 className="cfg-h">Agent registry</h3>
        <p className="cfg-note">
          Agents are capabilities, not features bolted onto modules: each is a record saying what
          it is for, how far it may act on its own, and whether a person has to approve the
          result. Workflows compose them; project templates decide which ones a project turns on.
        </p>
        <div className="cfg-warn">
          <strong>{live.length} of {agents.length} agents has an implementation.</strong> Every
          other entry is marked <em>declared</em>: the decision is recorded and the settings are
          real, but nothing in this build executes it. They are listed rather than hidden because
          the registry is the architecture — but a switch that silently did nothing would be
          worse than no switch at all, so the ones that cannot run cannot be enabled.
        </div>
      </section>

      {AGENT_FAMILIES.map((family) => {
        const inFamily = agents.filter((a) => a.family === (family as AgentFamily))
        if (!inFamily.length) return null
        return (
          <section className="cfg-section" key={family}>
            <div className="cfg-family">{family}</div>
            {inFamily.map((a) => (
              <div className="cfg-card" key={a.id}>
                <div className="cfg-card-head">
                  <span>{a.name}</span>
                  <span className="grow" />
                  {a.priority !== 'backlog' && <Badge kind={a.priority.toLowerCase()}>{a.priority}</Badge>}
                  <Badge kind={a.runtime}>{a.runtime === 'live' ? 'live' : 'declared'}</Badge>
                </div>
                <code className="cfg-key">{a.id}</code>
                <p className="cfg-card-desc">{a.description}</p>

                <div className="cfg-agent-ctl">
                  <label className="cfg-fld">
                    <span>Enabled</span>
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      disabled={a.runtime === 'declared'}
                      title={
                        a.runtime === 'declared'
                          ? 'Nothing executes this agent in this build, so enabling it would have no effect.'
                          : undefined
                      }
                      onChange={(e) => onConfig({ k: 'setAgent', id: a.id, patch: { enabled: e.target.checked } })}
                    />
                  </label>

                  <label className="cfg-fld">
                    <span>Autonomy</span>
                    <select
                      value={a.autonomy}
                      onChange={(e) =>
                        onConfig({ k: 'setAgent', id: a.id, patch: { autonomy: e.target.value as Autonomy } })
                      }
                    >
                      {AUTONOMY_ORDER.map((level) => {
                        const beyond = AUTONOMY_ORDER.indexOf(level) > AUTONOMY_ORDER.indexOf(a.maxAutonomy)
                        return (
                          <option key={level} value={level} disabled={beyond}>
                            {AUTONOMY_LABEL[level]}
                            {beyond ? ' — not implemented' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </label>

                  <label className="cfg-fld">
                    <span>Approval</span>
                    <select
                      value={a.requireApproval ? 'yes' : 'no'}
                      onChange={(e) =>
                        onConfig({
                          k: 'setAgent',
                          id: a.id,
                          patch: { requireApproval: e.target.value === 'yes' },
                        })
                      }
                    >
                      <option value="yes">A person approves</option>
                      <option value="no">No approval step</option>
                    </select>
                  </label>
                </div>

                {a.runtime === 'live' && (
                  <p className="cfg-inherit">
                    Enforced where it runs: below “propose”, the drafting tools are withheld from
                    the request entirely rather than merely discouraged.
                  </p>
                )}
              </div>
            ))}
          </section>
        )
      })}
    </>
  )
}

/* ================================================================== *
 * Workflows & templates
 * ================================================================== */

function Workflows({
  state,
  onConfig,
  scopes,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
  scopes: ScopeOption[]
}) {
  const model = state.model
  const [target, setTarget] = useState<string>(ROOT_SCOPE)

  return (
    <>
      <section className="cfg-section">
        <h3 className="cfg-h">Workflows</h3>
        <p className="cfg-note">
          A workflow is the composition — which agents run, in what order, and what has to finish
          before what. Agents stay generic; the workflow decides when they are used.
        </p>

        {Object.values(model.workflows).map((wf) => (
          <div className="cfg-card" key={wf.id}>
            <div className="cfg-card-head">
              <span>{wf.name}</span>
              <span className="grow" />
              <Badge kind={wf.runtime}>{wf.runtime === 'live' ? 'live' : 'declared'}</Badge>
            </div>
            <p className="cfg-card-desc">{wf.description}</p>
            <p className="cfg-card-meta"><span>Trigger: {wf.trigger}</span></p>
            <ol className="cfg-flow">
              {wf.steps.map((s, i) => {
                const agent = model.agents[s.agentId]
                return (
                  <li className="cfg-step" key={s.agentId}>
                    <span className="cfg-step-n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="cfg-step-name">{agent?.name ?? s.agentId}</span>
                    <span className="cfg-step-after">
                      {s.afterIds.length
                        ? `after ${s.afterIds.map((x) => model.agents[x]?.name ?? x).join(' + ')}`
                        : 'starts the workflow'}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Project templates</h3>
        <p className="cfg-note">
          A template is a bundle a project adopts: the agents it turns on and whether a person
          approves what they produce. Adopting one writes explicit per-agent settings at that
          scope, so the effect is visible and can be adjusted afterwards rather than being magic.
        </p>

        <div className="cfg-scope">
          <label htmlFor="cfg-template-scope">Apply to</label>
          <select id="cfg-template-scope" value={target} onChange={(e) => setTarget(e.target.value)}>
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === ROOT_SCOPE ? s.name : `${s.name} (${s.kind})`}
              </option>
            ))}
          </select>
          <span className="cfg-scope-hint">
            Currently following:{' '}
            {resolveTemplate(model, target === ROOT_SCOPE ? [] : scopeChainOf(state, target))?.name ??
              'nothing'}
          </span>
        </div>

        {Object.values(model.templates).map((t) => (
          <div className="cfg-card" key={t.id}>
            <div className="cfg-card-head">
              <span>{t.name}</span>
              <span className="grow" />
              <button
                className="btn"
                onClick={() => onConfig({ k: 'adoptTemplate', scopeId: target, templateId: t.id })}
              >
                Adopt here
              </button>
            </div>
            <p className="cfg-card-desc">{t.description}</p>
            <p className="cfg-card-meta">
              <span>{t.agentIds.length} agents</span>
              <span>{t.workflowIds.length} workflows</span>
              <span>{t.requireApproval ? 'a person approves every assignment' : 'no approval step'}</span>
            </p>
            <div className="cfg-chips">
              {t.agentIds.map((id) => (
                <span className="cfg-chip" key={id}>
                  {model.agents[id]?.name ?? id}
                </span>
              ))}
            </div>
          </div>
        ))}

        <div className="cfg-actions">
          <button
            className="btn ghost"
            onClick={() => onConfig({ k: 'adoptTemplate', scopeId: target, templateId: null })}
          >
            Clear template here
          </button>
        </div>
      </section>
    </>
  )
}

/* ================================================================== *
 * Routing & intake
 * ================================================================== */

function Routing({
  state,
  onConfig,
  scopes,
}: {
  state: WorkspaceState
  onConfig: (op: ConfigOp) => boolean
  scopes: ScopeOption[]
}) {
  const model = state.model
  const types = liveResponsibilities(model)
  const [rule, setRule] = useState({ name: '', module: '', severity: '', keyword: '', value: '', typeId: 'ISSUE_OWNER' })
  const [address, setAddress] = useState('')

  return (
    <>
      <section className="cfg-section">
        <div className="cfg-warn">
          Everything on this page is a <strong>configuration record</strong>. Nothing reads a
          mailbox and nothing applies a rule — there is no mail connection and no scheduler in
          this build. The records are here so the routing policy can be written down and
          reviewed; they are not a running system, and this page will not pretend they are by
          showing a preview of work that never happened.
        </div>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Routing rules</h3>
        <p className="cfg-note">
          Conditions that decide who a piece of work should go to. Evaluated in order; the first
          match wins.
        </p>

        {model.routingRules.map((r) => (
          <div className="cfg-card" key={r.id}>
            <div className="cfg-card-head">
              <span>{r.name}</span>
              <span className="grow" />
              <Badge kind="declared">declared</Badge>
              <button className="btn ghost" onClick={() => onConfig({ k: 'deleteRoutingRule', id: r.id })}>
                Remove
              </button>
            </div>
            <p className="cfg-card-meta">
              When{' '}
              {[
                r.when.module && `area is ${r.when.module}`,
                r.when.severity && `severity is ${r.when.severity}`,
                r.when.keyword && `text contains “${r.when.keyword}”`,
              ]
                .filter(Boolean)
                .join(' and ') || 'anything'}{' '}
              → set {model.responsibilities[r.then.responsibilityTypeId]?.label ?? r.then.responsibilityTypeId} to{' '}
              {r.then.value}
            </p>
          </div>
        ))}
        {!model.routingRules.length && <div className="cfg-empty">No routing rules configured.</div>}

        <div className="cfg-card">
          <div className="cfg-card-head">
            <span>New rule</span>
          </div>
          <div className="cfg-fld-row">
            <label className="cfg-fld">
              <span>Name</span>
              <input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} />
            </label>
            <label className="cfg-fld">
              <span>Process area is</span>
              <input value={rule.module} onChange={(e) => setRule({ ...rule, module: e.target.value })} />
            </label>
            <label className="cfg-fld">
              <span>Severity is</span>
              <select value={rule.severity} onChange={(e) => setRule({ ...rule, severity: e.target.value })}>
                <option value="">any</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
            <label className="cfg-fld">
              <span>Text contains</span>
              <input value={rule.keyword} onChange={(e) => setRule({ ...rule, keyword: e.target.value })} />
            </label>
          </div>
          <div className="cfg-fld-row">
            <label className="cfg-fld">
              <span>Then set</span>
              <select value={rule.typeId} onChange={(e) => setRule({ ...rule, typeId: e.target.value })}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cfg-fld">
              <span>To</span>
              <input value={rule.value} onChange={(e) => setRule({ ...rule, value: e.target.value })} />
            </label>
          </div>
          <div className="cfg-actions">
            <button
              className="btn primary"
              disabled={!rule.name.trim() || !rule.value.trim()}
              onClick={() => {
                const ok = onConfig({
                  k: 'upsertRoutingRule',
                  id: null,
                  patch: {
                    name: rule.name,
                    when: { module: rule.module, severity: rule.severity, keyword: rule.keyword },
                    then: { responsibilityTypeId: rule.typeId, value: rule.value },
                  },
                })
                if (ok) setRule({ name: '', module: '', severity: '', keyword: '', value: '', typeId: 'ISSUE_OWNER' })
              }}
            >
              Add rule
            </button>
          </div>
        </div>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Mail intake</h3>
        <p className="cfg-note">
          Addresses that work would arrive at, and the workflow that would process each one.
        </p>

        {model.intake.map((box) => (
          <div className="cfg-card" key={box.id}>
            <div className="cfg-card-head">
              <span className="mono">{box.address}</span>
              <span className="grow" />
              <Badge kind="declared">declared</Badge>
              <button className="btn ghost" onClick={() => onConfig({ k: 'deleteIntake', id: box.id })}>
                Remove
              </button>
            </div>
            <div className="cfg-fld-row">
              <label className="cfg-fld">
                <span>Files under</span>
                <select
                  value={box.scopeId}
                  onChange={(e) =>
                    onConfig({ k: 'upsertIntake', id: box.id, patch: { scopeId: e.target.value } })
                  }
                >
                  {scopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id === ROOT_SCOPE ? s.name : `${s.name} (${s.kind})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cfg-fld">
                <span>Processed by</span>
                <select
                  value={box.workflowId ?? ''}
                  onChange={(e) =>
                    onConfig({
                      k: 'upsertIntake',
                      id: box.id,
                      patch: { workflowId: e.target.value || null },
                    })
                  }
                >
                  <option value="">nothing</option>
                  {Object.values(model.workflows).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
        {!model.intake.length && <div className="cfg-empty">No mailboxes configured.</div>}

        <div className="cfg-inline">
          <input
            value={address}
            placeholder="project@example.com"
            aria-label="New intake address"
            onChange={(e) => setAddress(e.target.value)}
          />
          <button
            className="btn"
            disabled={!address.trim()}
            onClick={() => {
              if (onConfig({ k: 'upsertIntake', id: null, patch: { address } })) setAddress('')
            }}
          >
            Add mailbox
          </button>
        </div>
      </section>
    </>
  )
}

/* ================================================================== *
 * Scope overrides
 * ================================================================== */

function Scopes({
  state,
  scopeId,
  setScopeId,
  scopes,
  chain,
  onConfig,
}: {
  state: WorkspaceState
  scopeId: string
  setScopeId: (id: string) => void
  scopes: ScopeOption[]
  chain: string[]
  onConfig: (op: ConfigOp) => boolean
}) {
  const model = state.model
  const override = model.overrides[scopeId]
  const parentChain = chain.filter((c) => c !== scopeId)

  return (
    <>
      <ScopeBar
        scopeId={scopeId}
        setScopeId={setScopeId}
        scopes={scopes}
        hint={
          scopeId === ROOT_SCOPE
            ? 'The organisation default. Everything else inherits from here.'
            : `Inherits from ${parentChain.map((c) => nameOf(state, c)).join(' ← ') || 'the organisation'}.`
        }
      />

      <section className="cfg-section">
        <h3 className="cfg-h">What this scope changes</h3>
        <p className="cfg-note">
          Resolution walks the tree from a record upwards and takes the first value it finds, so
          a term or a policy set here applies to everything beneath it and to nothing beside it.
        </p>

        {!override ||
        (!Object.keys(override.labels).length &&
          !Object.keys(override.agentEnabled).length &&
          !Object.keys(override.responsibilityRequired).length &&
          !override.templateId) ? (
          <div className="cfg-empty">
            Nothing is overridden here — everything follows the level above.
          </div>
        ) : (
          <table className="cfg-table">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Here</th>
                <th>Inherited</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(override.labels).map(([key, value]) => (
                <tr key={key}>
                  <td>
                    <code className="cfg-key">{key}</code>
                  </td>
                  <td>{value}</td>
                  <td className="cfg-inherit">{resolveLabel(model, key as LabelKey, parentChain)}</td>
                  <td>
                    <button
                      className="btn ghost"
                      onClick={() => onConfig({ k: 'setLabel', scopeId, key: key as LabelKey, label: '' })}
                    >
                      Reset
                    </button>
                  </td>
                </tr>
              ))}
              {Object.entries(override.agentEnabled).map(([id, on]) => (
                <tr key={id}>
                  <td>{model.agents[id]?.name ?? id}</td>
                  <td>{on ? 'on' : 'off'}</td>
                  <td className="cfg-inherit">
                    {resolveAgentEnabled(model, id, parentChain) ? 'on' : 'off'}
                  </td>
                  <td>
                    <button
                      className="btn ghost"
                      onClick={() => onConfig({ k: 'setScopeAgent', scopeId, agentId: id, value: null })}
                    >
                      Reset
                    </button>
                  </td>
                </tr>
              ))}
              {Object.entries(override.responsibilityRequired).map(([id, req]) => (
                <tr key={id}>
                  <td>{model.responsibilities[id]?.label ?? id}</td>
                  <td>{req ? 'required' : 'optional'}</td>
                  <td className="cfg-inherit">
                    {resolveRequired(model, id, parentChain) ? 'required' : 'optional'}
                  </td>
                  <td>
                    <button
                      className="btn ghost"
                      onClick={() =>
                        onConfig({ k: 'setScopeRequired', scopeId, responsibilityId: id, value: null })
                      }
                    >
                      Reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Responsibilities required here</h3>
        <p className="cfg-note">
          A responsibility can be optional across the organisation but mandatory on one
          engagement.
        </p>
        <table className="cfg-table">
          <thead>
            <tr>
              <th>Responsibility</th>
              <th>Here</th>
            </tr>
          </thead>
          <tbody>
            {liveResponsibilities(model).map((t) => {
              const explicit = override?.responsibilityRequired?.[t.id]
              return (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td>
                    <select
                      value={explicit === undefined ? '' : explicit ? 'yes' : 'no'}
                      aria-label={`Is ${t.label} required here`}
                      onChange={(e) =>
                        onConfig({
                          k: 'setScopeRequired',
                          scopeId,
                          responsibilityId: t.id,
                          value: e.target.value === '' ? null : e.target.value === 'yes',
                        })
                      }
                    >
                      <option value="">
                        inherit — {resolveRequired(model, t.id, parentChain) ? 'required' : 'optional'}
                      </option>
                      <option value="yes">required</option>
                      <option value="no">optional</option>
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="cfg-section">
        <h3 className="cfg-h">Agents here</h3>
        <p className="cfg-note">
          Turn an agent on or off for this branch only. Agents with no runtime are listed so the
          policy is complete, but switching them changes nothing until something implements them.
        </p>
        <table className="cfg-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Here</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(model.agents)
              .filter((a) => a.runtime === 'live' || override?.agentEnabled?.[a.id] !== undefined)
              .map((a) => {
                const explicit = override?.agentEnabled?.[a.id]
                return (
                  <tr key={a.id}>
                    <td>
                      {a.name} <Badge kind={a.runtime}>{a.runtime}</Badge>
                    </td>
                    <td>
                      <select
                        value={explicit === undefined ? '' : explicit ? 'on' : 'off'}
                        aria-label={`Is ${a.name} enabled here`}
                        onChange={(e) =>
                          onConfig({
                            k: 'setScopeAgent',
                            scopeId,
                            agentId: a.id,
                            value: e.target.value === '' ? null : e.target.value === 'on',
                          })
                        }
                      >
                        <option value="">
                          inherit — {resolveAgentEnabled(model, a.id, parentChain) ? 'on' : 'off'}
                        </option>
                        <option value="on">on</option>
                        <option value="off">off</option>
                      </select>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </section>
    </>
  )
}

/* ================================================================== *
 * Rates
 * ================================================================== */

/**
 * What people cost and what they are charged out at, over time.
 *
 * This tab is not rendered at all without `rate.view`, and the data behind it is removed from
 * the page payload for the same actors — see `boot()`. Hiding a figure on screen while shipping
 * it in the initial HTML is the failure this product has already had once.
 *
 * Cost and bill are shown side by side per person because the interesting number is the gap
 * between them, and a screen that made you click twice to compare would be a screen where
 * nobody compared.
 */
function Rates({
  state,
  actor,
  onRecord,
  onCorrect,
}: {
  state: WorkspaceState
  actor: Actor
  onRecord: (r: { personId: string; kind: RateKind; validFrom: string; validTo: string | null; amount: number; currency: string; reason: string }) => boolean
  onCorrect: (id: string, patch: { validFrom?: string; amount?: number }, reason: string) => boolean
}) {
  const mayEdit = can(state.model, actor, 'rate.edit')
  const rates = Object.values(state.rates)
  const people = Object.values(state.model.people).sort((a, b) => a.name.localeCompare(b.name))

  const [who, setWho] = useState('')
  const [kind, setKind] = useState<RateKind>('cost')
  const [from, setFrom] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('GBP')
  const [why, setWhy] = useState('')
  const [correcting, setCorrecting] = useState<string | null>(null)
  const [newAmount, setNewAmount] = useState('')
  const [correctWhy, setCorrectWhy] = useState('')

  /* Only people with something recorded, plus whoever is being edited. A directory of 26 with
     four rates in it is a page of empty rows otherwise. */
  const withRates = people.filter((p) => rates.some((r) => r.personId === p.id))
  const ready = who && from && Number(amount) > 0 && why.trim() !== ''

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Rates</h3>
      <p className="cfg-note">
        What a person costs the firm and what a client is charged, per hour, over a period. Both
        are dated: an hour is priced at the rate in force on the day it was worked, so a rise in
        July does not change what March cost.
      </p>
      <p className="cfg-note">
        Cost and charge-out move independently — a pay rise does not change a signed rate card,
        and a renegotiated card does not change anybody&rsquo;s pay — so they are recorded
        separately rather than as one row with two columns.
      </p>
      <p className="cfg-note">
        These figures are withheld from the page entirely for anybody without <em>See rates</em>,
        not merely hidden on screen. The audit trail records that a rate was set and from when,
        and deliberately not what it was set to.
      </p>

      {withRates.length === 0 ? (
        <p className="cfg-note">
          Nothing recorded yet. Until a person has both a cost and a charge-out rate covering a
          day, work done on that day has no cost — and the figure is reported as absent rather
          than as a smaller number.
        </p>
      ) : (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>What</th>
              <th>From</th>
              <th>To</th>
              <th>Per hour</th>
              <th>Why</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {withRates.flatMap((p) =>
              (['cost', 'bill'] as RateKind[]).flatMap((k) =>
                rateTimeline(rates, p.id, k).map((r) => [
                  <tr key={r.id}>
                    <td>{p.name}</td>
                    <td>{k === 'cost' ? 'Cost' : 'Charge-out'}</td>
                    <td className="mono">{r.validFrom}</td>
                    <td className="mono">{r.validTo ?? 'open'}</td>
                    <td className="mono">
                      {r.currency} {r.amount.toLocaleString()}
                    </td>
                    <td>
                      {r.reason} <span className="est-block-note">— {r.by}</span>
                    </td>
                    <td>
                      {mayEdit.allowed && (
                        <button
                          className="btn-link"
                          onClick={() => {
                            setCorrecting(correcting === r.id ? null : r.id)
                            setNewAmount(String(r.amount))
                          }}
                        >
                          {correcting === r.id ? 'Cancel' : 'Correct'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  correcting === r.id ? (
                    <tr key={`${r.id}-fix`}>
                      <td colSpan={7}>
                        <div className="time-row">
                          <label className="fld time-fld-hours">
                            <span className="fld-label">Per hour</span>
                            <input type="number" min={0} step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
                          </label>
                          <label className="fld time-fld-note">
                            <span className="fld-label">Why it was wrong</span>
                            <input value={correctWhy} onChange={(e) => setCorrectWhy(e.target.value)} />
                          </label>
                          <button
                            className="btn"
                            disabled={!correctWhy.trim() || !(Number(newAmount) > 0)}
                            title={correctWhy.trim() ? 'Correct it' : 'A correction needs a reason'}
                            onClick={() => {
                              if (onCorrect(r.id, { amount: Number(newAmount) }, correctWhy)) {
                                setCorrecting(null)
                                setCorrectWhy('')
                              }
                            }}
                          >
                            Correct
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ]),
              ),
            )}
          </tbody>
        </table>
      )}

      {mayEdit.allowed ? (
        <div className="time-form">
          <div className="time-row">
            <label className="fld time-fld-person">
              <span className="fld-label">Who</span>
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose a person…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld">
              <span className="fld-label">What</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as RateKind)}>
                <option value="cost">Cost to the firm</option>
                <option value="bill">Charged to the client</option>
              </select>
            </label>
            <label className="fld">
              <span className="fld-label">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="fld time-fld-hours">
              <span className="fld-label">Per hour</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="fld">
              <span className="fld-label">Currency</span>
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
            </label>
            <label className="fld time-fld-note">
              <span className="fld-label">Why</span>
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="New starter, annual review, renegotiated card" />
            </label>
            {/*
              * No end date. A rate runs until the next one is recorded, and the reducer refuses
              * an overlap — so naming an end now would be inventing when it stops.
              */}
            <button
              className="btn"
              disabled={!ready}
              title={ready ? 'Record it' : 'Needs a person, a date, an amount and a reason'}
              onClick={() => {
                if (
                  onRecord({
                    personId: who,
                    kind,
                    validFrom: from,
                    validTo: null,
                    amount: Number(amount),
                    currency,
                    reason: why,
                  })
                ) {
                  setAmount('')
                  setWhy('')
                }
              }}
            >
              Record
            </button>
          </div>
        </div>
      ) : (
        <p className="cfg-note">{mayEdit.reason ?? 'Read only.'}</p>
      )}
    </section>
  )
}

/* ================================================================== *
 * Skills
 * ================================================================== */

/**
 * What people can do, and the firm's catalogue of what there is to be able to do.
 *
 * Both on one screen because they are useless apart: a catalogue nobody is recorded against
 * answers nothing, and a level against a skill that is not in the catalogue cannot be recorded
 * at all. They travel by different routes — the catalogue is configuration, a level is a record
 * — and the screen says so rather than hiding it.
 *
 * The tab is visible to everybody, unlike Rates. Without `skill.view` the levels arrive stripped
 * and the table says so plainly; what survives is who holds which skill and when they last used
 * it, which is the half worth having a directory for.
 */
function Skills({
  state,
  actor,
  onConfig,
  onRecord,
  onCorrect,
  onRemove,
}: {
  state: WorkspaceState
  actor: Actor
  onConfig: (op: ConfigOp) => boolean
  onRecord: (r: { personId: string; skillId: string; level: SkillLevel; source: SkillSource; assessedBy: string | null; lastUsedOn: string | null; note: string }) => boolean
  onCorrect: (id: string, patch: { level?: SkillLevel; source?: SkillSource; assessedBy?: string | null; lastUsedOn?: string | null; note?: string }) => boolean
  onRemove: (id: string) => boolean
}) {
  const mayConfigure = can(state.model, actor, 'config.manage')
  const mayAssess = can(state.model, actor, 'skill.assess')
  const mayRecord = can(state.model, actor, 'skill.record')
  const maySeeLevels = can(state.model, actor, 'skill.view')

  const catalogue = liveSkills(state.model)
  const people = Object.values(state.model.people).sort((a, b) => a.name.localeCompare(b.name))
  const rows = Object.values(state.personSkills).filter((p) => !p.deletedAt)
  const me = directoryPersonFor(state.model, actor)

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')

  /* Defaults to you. Somebody without `skill.assess` cannot change it, and the control is
     disabled rather than absent so the reason is visible rather than mysterious. */
  const [who, setWho] = useState(me?.id ?? '')
  const [skillId, setSkillId] = useState('')
  const [level, setLevel] = useState<SkillLevel>('working')
  const [source, setSource] = useState<SkillSource>('self')
  const [assessedBy, setAssessedBy] = useState('')
  const [lastUsedOn, setLastUsedOn] = useState('')
  const [note, setNote] = useState('')

  /* One row at a time, like the Rates tab. */
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixLevel, setFixLevel] = useState<SkillLevel>('working')
  const [fixUsed, setFixUsed] = useState('')

  const nameOf = (personId: string) => state.model.people[personId]?.name ?? personId
  const ready = who && skillId && (source !== 'assessed' || assessedBy.trim() !== '')

  return (
    <section className="cfg-section">
      <h3 className="cfg-h">Skills</h3>
      <p className="cfg-note">
        What people can do, how well, and how recently. A level is dated by when the skill was
        last <em>used</em>, not by when it was recorded &mdash; a consultant who last touched a
        module four years ago is not a current practitioner in it, and a staffing shortlist that
        cannot tell those apart proposes the wrong person with confidence.
      </p>
      <p className="cfg-note">
        This does not schedule anybody. It can say who is able to do a piece of work; it cannot
        see who the client already trusts, who was on the call last week, who is free, or what
        anybody costs &mdash; and those routinely decide the staffing.
      </p>

      <h4 className="cfg-sub">The catalogue</h4>
      <p className="cfg-note">
        The firm&rsquo;s own list. Nothing is shipped in it: roles and work types have defensible
        defaults because every consultancy has roughly those, and a skill list is the one part of
        an operating model that is the firm&rsquo;s own competitive shape.
      </p>

      {catalogue.length === 0 ? (
        <p className="cfg-note">Nothing in the catalogue yet. Add the first skill below.</p>
      ) : (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Group</th>
              <th>What it means</th>
              <th>Recorded against</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {catalogue.map((sk) => {
              const held = rows.filter((r) => r.skillId === sk.id).length
              return (
                <tr key={sk.id}>
                  <td>{sk.name}</td>
                  <td>{sk.category || <span className="est-block-note">&mdash;</span>}</td>
                  <td>{sk.description}</td>
                  <td className="mono">{held}</td>
                  <td>
                    {mayConfigure.allowed && (
                      <button
                        className="btn-link"
                        disabled={held > 0}
                        title={held > 0 ? `${held} recorded against it. Withdraw those first.` : 'Retire it'}
                        onClick={() => onConfig({ k: 'deleteSkill', id: sk.id })}
                      >
                        Retire
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {mayConfigure.allowed ? (
        <div className="time-form">
          <div className="time-row">
            <label className="fld time-fld-person">
              <span className="fld-label">Skill</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Intercompany, X++ extensions, Data migration" />
            </label>
            <label className="fld">
              <span className="fld-label">Group</span>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="D365 Finance" />
            </label>
            <label className="fld time-fld-note">
              <span className="fld-label">What it means</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="So two people rating themselves answer the same question" />
            </label>
            <button
              className="btn"
              disabled={!name.trim()}
              title={name.trim() ? 'Add it' : 'A skill needs a name'}
              onClick={() => {
                if (onConfig({ k: 'upsertSkill', id: null, name, category, description })) {
                  setName('')
                  setCategory('')
                  setDescription('')
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <p className="cfg-note">{mayConfigure.reason ?? 'The catalogue is read only for you.'}</p>
      )}

      <h4 className="cfg-sub">Who can do what</h4>
      {!maySeeLevels.allowed && (
        <p className="cfg-note">
          Levels are not shown at your access level, and are not sent to this page at all &mdash;
          what you see below is who holds a skill and when they last used it. Your own are always
          shown in full.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="cfg-note">
          Nobody is recorded against anything yet. Until somebody is, no shortlist can be
          produced &mdash; and an empty shortlist would mean &ldquo;nothing is written down&rdquo;
          rather than &ldquo;nobody can do it&rdquo;.
        </p>
      ) : (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Skill</th>
              <th>Level</th>
              <th>Who says so</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => nameOf(a.personId).localeCompare(nameOf(b.personId)) || a.skillId.localeCompare(b.skillId))
              .flatMap((r) => {
                const stale = isStale(r.lastUsedOn, new Date().toISOString().slice(0, 10))
                const mineToTouch = me?.id === r.personId
                return [
                  <tr key={r.id}>
                    <td>{nameOf(r.personId)}</td>
                    <td>{skillName(state.model, r.skillId)}</td>
                    <td>
                      {r.level ? (
                        levelLabel(r.level)
                      ) : (
                        <span className="est-block-note">not shown at your access level</span>
                      )}
                    </td>
                    <td>
                      {r.source ? (
                        <>
                          {sourceLabel(r.source)}
                          {r.assessedBy && <span className="est-block-note"> &mdash; {r.assessedBy}</span>}
                        </>
                      ) : (
                        <span className="est-block-note">&mdash;</span>
                      )}
                    </td>
                    <td className="mono">
                      {r.lastUsedOn ?? <span className="est-block-note">not said</span>}
                      {stale && <span className="est-block-note"> &middot; stale</span>}
                    </td>
                    <td>
                      {(mineToTouch || mayAssess.allowed) && (
                        <>
                          {/*
                            * Two conditions, and the second is the one that is easy to miss.
                            *
                            * `r.level !== null` — correcting a level you cannot see would mean
                            * overwriting a value blind, and the form has nothing honest to
                            * prefill with.
                            *
                            * `r.source === 'self' || mayAssess` — the reducer inherits `source`
                            * from the stored row when the patch omits it, and this patch does
                            * omit it, so correcting an ASSESSED row is an assessed write and
                            * takes `skill.assess`. Without this the button rendered on exactly
                            * the row a consultant most wants to fix — their own, assessed by
                            * somebody else — and every click was refused.
                            */}
                          {r.level !== null && (r.source === 'self' || mayAssess.allowed) && (
                            <>
                              <button
                                className="btn-link"
                                onClick={() => {
                                  setFixing(fixing === r.id ? null : r.id)
                                  setFixLevel(r.level ?? 'working')
                                  setFixUsed(r.lastUsedOn ?? '')
                                }}
                              >
                                {fixing === r.id ? 'Cancel' : 'Correct'}
                              </button>{' '}
                            </>
                          )}
                          {/* Same gate as Correct, because the reducer applies the same one. */}
                          {(r.source === 'self' || mayAssess.allowed) && (
                            <button className="btn-link" onClick={() => onRemove(r.id)}>
                              Withdraw
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>,
                  fixing === r.id ? (
                    <tr key={`${r.id}-fix`}>
                      <td colSpan={6}>
                        <div className="time-row">
                          <label className="fld">
                            <span className="fld-label">Level</span>
                            <select value={fixLevel} onChange={(e) => setFixLevel(e.target.value as SkillLevel)}>
                              {SKILL_LEVELS.map((l) => (
                                <option key={l.key} value={l.key}>
                                  {l.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="fld">
                            <span className="fld-label">Last used</span>
                            <input type="date" value={fixUsed} onChange={(e) => setFixUsed(e.target.value)} />
                          </label>
                          {/*
                            * `source` is not offered here. Changing self-rated to assessed is
                            * not a correction, it is a different claim by a different person,
                            * and it should be recorded as one rather than edited in place.
                            */}
                          <span className="est-block-note">
                            Who says so does not change here &mdash; withdraw and record it again
                            if the claim itself is different.
                          </span>
                          <button
                            className="btn"
                            onClick={() => {
                              if (onCorrect(r.id, { level: fixLevel, lastUsedOn: fixUsed || null })) {
                                setFixing(null)
                              }
                            }}
                          >
                            Correct
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
          </tbody>
        </table>
      )}

      {mayRecord.allowed && catalogue.length > 0 ? (
        <div className="time-form">
          <div className="time-row">
            <label className="fld time-fld-person">
              <span className="fld-label">Who</span>
              <select
                value={who}
                disabled={!mayAssess.allowed}
                title={mayAssess.allowed ? undefined : 'You can record your own skills. Recording somebody else\u2019s needs the grant for it.'}
                onChange={(e) => setWho(e.target.value)}
              >
                <option value="">Choose a person&hellip;</option>
                {people.map((pp) => (
                  <option key={pp.id} value={pp.id}>
                    {pp.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld time-fld-person">
              <span className="fld-label">Skill</span>
              <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                <option value="">Choose a skill&hellip;</option>
                {catalogue.map((sk) => (
                  <option key={sk.id} value={sk.id}>
                    {sk.category ? `${sk.category} \u2014 ${sk.name}` : sk.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld">
              <span className="fld-label">Level</span>
              <select value={level} onChange={(e) => setLevel(e.target.value as SkillLevel)}>
                {SKILL_LEVELS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld">
              <span className="fld-label">Who says so</span>
              <select
                value={source}
                disabled={!mayAssess.allowed}
                title={mayAssess.allowed ? undefined : 'Self-rated is the only source you can set on your own record. That is what the word means.'}
                onChange={(e) => setSource(e.target.value as SkillSource)}
              >
                <option value="self">Self-rated</option>
                <option value="assessed">Assessed</option>
                <option value="certified">Certified</option>
              </select>
            </label>
            {source === 'assessed' && (
              <label className="fld">
                <span className="fld-label">Assessed by</span>
                <input value={assessedBy} onChange={(e) => setAssessedBy(e.target.value)} placeholder="Whose judgement this is" />
              </label>
            )}
            <label className="fld">
              <span className="fld-label">Last used</span>
              <input type="date" value={lastUsedOn} onChange={(e) => setLastUsedOn(e.target.value)} />
            </label>
            <label className="fld time-fld-note">
              <span className="fld-label">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where, and on what" />
            </label>
            <button
              className="btn"
              disabled={!ready}
              title={ready ? 'Record it' : 'Needs a person, a skill, and an assessor if it is assessed'}
              onClick={() => {
                if (
                  onRecord({
                    personId: who,
                    skillId,
                    level,
                    source,
                    assessedBy: source === 'assessed' ? assessedBy : null,
                    lastUsedOn: lastUsedOn || null,
                    note,
                  })
                ) {
                  setSkillId('')
                  setNote('')
                  setAssessedBy('')
                }
              }}
            >
              Record
            </button>
          </div>
          {/*
            * Deliberately not offered: a date for when the level was reached. It would be
            * recorded once and never corrected, and a wrong date on a capability claim is worse
            * than no date. `Last used` is the field that decays, and it is the one that matters.
            */}
        </div>
      ) : (
        <p className="cfg-note">
          {catalogue.length === 0
            ? 'Add something to the catalogue before recording anybody against it.'
            : mayRecord.reason ?? 'Read only.'}
        </p>
      )}
    </section>
  )
}
