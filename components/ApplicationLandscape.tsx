'use client'

import { useMemo, useState } from 'react'
import DetailDrawer from './DetailDrawer'
import { can } from '@/lib/access'
import { isTerminal } from '@/lib/schedule'
import { externalPartyKinds, tiersOf } from '@/lib/config'
import {
  applicationConcerns,
  APPLICATION_STATUSES,
  INTEGRATION_STATUSES,
  type Application,
} from '@/lib/application'
import type { WorkspaceState } from '@/lib/workspace'
import type { Actor } from '@/lib/actor'

/**
 * Every application at once — a client's own technology landscape. See
 * `docs/plans/2026-09-07-application-suite-design.md`.
 *
 * Health is named concerns, the same doctrine `PortfolioPanel.tsx` already applies to
 * engagements: no score, a plain claim with a number, checkable in one click.
 *
 * Named callback props, not a raw `dispatch` — the same shape `CommercialPanel.tsx` and
 * `PortfolioPanel.tsx` already use for every top-level view that writes.
 */
export default function ApplicationLandscape({
  state,
  actor,
  today,
  onUpsertApplication,
  onUpsertIntegrationLink,
  docked = false,
  onClose,
}: {
  state: WorkspaceState
  actor: Actor
  today: string
  onUpsertApplication: (id: string | null, clientNodeId: string | undefined, patch: Partial<Application>) => boolean
  onUpsertIntegrationLink: (
    id: string | null,
    sourceApplicationId: string | undefined,
    targetApplicationId: string | undefined,
    patch: Partial<{ interface: string; businessProcess: string; frequency: string; status: string }>,
  ) => boolean
  docked?: boolean
  onClose?: () => void
}) {
  const mayEdit = can(state.model, actor, 'application.edit').allowed

  const clientNodes = useMemo(() => {
    const kinds = externalPartyKinds(tiersOf(state.model))
    return Object.values(state.nodes)
      .filter((n) => !n.deletedAt && kinds.has(n.kind))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.model, state.nodes])

  const apps = useMemo(
    () => Object.values(state.applications).filter((a) => !a.deletedAt),
    [state.applications],
  )

  // A lightweight, local "overdue" — the same test lib/watch.ts's own `overdue` condition
  // applies (past its planned end, not yet in a terminal status) — computed here rather than
  // imported so this panel needs no server round trip to render.
  const issuesWithOverdue = useMemo(
    () =>
      Object.values(state.issues)
        .filter((i) => !i.deletedAt)
        .map((i) => ({
          applicationId: i.applicationId,
          deletedAt: i.deletedAt,
          severity: i.severity,
          overdue: !isTerminal(i.status) && !!i.plannedEnd && i.plannedEnd < today,
        })),
    [state.issues, today],
  )
  const links = useMemo(() => Object.values(state.integrationLinks), [state.integrationLinks])

  const byClient = useMemo(() => {
    const m = new Map<string, Application[]>()
    for (const app of apps) {
      const list = m.get(app.clientNodeId) ?? []
      list.push(app)
      m.set(app.clientNodeId, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return m
  }, [apps])

  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const opening = openId ? state.applications[openId] : null

  const panel = (
    <>
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="applications-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="applications-title">Applications</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close applications">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">What each client runs, and how it connects.</div>
          {mayEdit && (
            <button className="btn ghost" onClick={() => setAdding(true)}>
              Add application…
            </button>
          )}
        </header>

        <div className="evi-list">
          {!apps.length && (
            <p className="evi-empty">
              Nothing recorded yet. An application belongs to a client node in the tree — add
              one to start tracking what they run.
            </p>
          )}

          {[...byClient.entries()].map(([clientNodeId, list]) => (
            <section key={clientNodeId}>
              <h3 className="evi-item-name" style={{ padding: '8px 4px 4px' }}>
                {state.nodes[clientNodeId]?.name ?? clientNodeId}
              </h3>
              {list.map((app) => {
                const concerns = applicationConcerns(app.id, issuesWithOverdue, links)
                return (
                  <div key={app.id} className="evi-item">
                    <div className="evi-item-body">
                      <button
                        type="button"
                        className="btn-link mywork-title"
                        onClick={() => setOpenId(app.id)}
                      >
                        {app.name}
                      </button>
                      <div className="evi-item-meta">
                        <span className="mono">{app.platform || 'platform not recorded'}</span>
                        {app.environment && <span className="chip">{app.environment}</span>}
                        <span>{app.status}</span>
                      </div>
                      {concerns.length ? (
                        <p className="zone-note needed">
                          {concerns.map((c) => c.phrase).join(', ')}.
                        </p>
                      ) : (
                        <p className="evi-source-meta">Nothing open, overdue, or marked Inactive.</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </aside>

      {adding && (
        <ApplicationForm
          state={state}
          clientNodes={clientNodes}
          onCancel={() => setAdding(false)}
          onSave={(clientNodeId, patch) => {
            const ok = onUpsertApplication(null, clientNodeId, patch)
            if (ok) setAdding(false)
            return ok
          }}
        />
      )}

      {opening && (
        <DetailDrawer wide onClose={() => setOpenId(null)}>
          <ApplicationDetail
            state={state}
            app={opening}
            mayEdit={mayEdit}
            onUpsertApplication={onUpsertApplication}
            onUpsertIntegrationLink={onUpsertIntegrationLink}
            onClose={() => setOpenId(null)}
          />
        </DetailDrawer>
      )}
    </>
  )

  return docked ? <div className="view-dock">{panel}</div> : panel
}

function ApplicationForm({
  state,
  clientNodes,
  onCancel,
  onSave,
}: {
  state: WorkspaceState
  clientNodes: { id: string; name: string }[]
  onCancel: () => void
  onSave: (clientNodeId: string, patch: Partial<Application>) => boolean
}) {
  const [clientNodeId, setClientNodeId] = useState('')
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState('')
  const [environment, setEnvironment] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="modal-scrim" role="dialog" aria-label="Add an application">
      <div className="modal" style={{ maxWidth: 480 }}>
        <h3>Add an application</h3>
        <label className="cfg-fld">
          <span>Client</span>
          <select value={clientNodeId} onChange={(e) => setClientNodeId(e.target.value)}>
            <option value="">Choose a client…</option>
            {clientNodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
        <label className="cfg-fld">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="D365 Finance & Operations" />
        </label>
        <label className="cfg-fld">
          <span>Platform</span>
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="D365 F&O" />
        </label>
        <label className="cfg-fld">
          <span>Environment</span>
          <input value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="PROD" />
        </label>
        {error && <p className="ov-gate">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn primary"
            disabled={!clientNodeId || !name.trim()}
            onClick={() => {
              if (!onSave(clientNodeId, { name, platform, environment, status: 'Planned' })) {
                setError('That application could not be saved.')
              }
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function ApplicationDetail({
  state,
  app,
  mayEdit,
  onUpsertApplication,
  onUpsertIntegrationLink,
  onClose,
}: {
  state: WorkspaceState
  app: Application
  mayEdit: boolean
  onUpsertApplication: (id: string | null, clientNodeId: string | undefined, patch: Partial<Application>) => boolean
  onUpsertIntegrationLink: (
    id: string | null,
    sourceApplicationId: string | undefined,
    targetApplicationId: string | undefined,
    patch: Partial<{ interface: string; businessProcess: string; frequency: string; status: string }>,
  ) => boolean
  onClose: () => void
}) {
  const issues = useMemo(
    () => Object.values(state.issues).filter((i) => i.applicationId === app.id && !i.deletedAt),
    [state.issues, app.id],
  )
  const linksFrom = useMemo(
    () =>
      Object.values(state.integrationLinks).filter(
        (l) => !l.deletedAt && (l.sourceApplicationId === app.id || l.targetApplicationId === app.id),
      ),
    [state.integrationLinks, app.id],
  )
  const otherApps = useMemo(
    () => Object.values(state.applications).filter((a) => !a.deletedAt && a.id !== app.id),
    [state.applications, app.id],
  )

  const [linking, setLinking] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [interfaceName, setInterfaceName] = useState('')
  const [businessProcess, setBusinessProcess] = useState('')

  return (
    <div>
      <h3>{app.name}</h3>
      <dl className="kv">
        <dt>Client</dt>
        <dd>{state.nodes[app.clientNodeId]?.name ?? app.clientNodeId}</dd>
        <dt>Platform</dt>
        <dd>
          {mayEdit ? (
            <input
              value={app.platform}
              onChange={(e) => onUpsertApplication(app.id, undefined, { platform: e.target.value })}
            />
          ) : (
            app.platform || 'not recorded'
          )}
        </dd>
        <dt>Environment</dt>
        <dd>
          {mayEdit ? (
            <input
              value={app.environment}
              onChange={(e) => onUpsertApplication(app.id, undefined, { environment: e.target.value })}
            />
          ) : (
            app.environment || 'not recorded'
          )}
        </dd>
        <dt>Status</dt>
        <dd>
          {mayEdit ? (
            <select
              value={app.status}
              onChange={(e) => onUpsertApplication(app.id, undefined, { status: e.target.value as Application['status'] })}
            >
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            app.status
          )}
        </dd>
        <dt>Owner</dt>
        <dd>
          {mayEdit ? (
            <input
              value={app.owner}
              onChange={(e) => onUpsertApplication(app.id, undefined, { owner: e.target.value })}
            />
          ) : (
            app.owner || 'not recorded'
          )}
        </dd>
      </dl>

      <h4 className="est-h">Issues ({issues.length})</h4>
      {issues.length ? (
        <ul>
          {issues.map((i) => (
            <li key={i.id}>
              <span className="mono">{i.id}</span> {i.subject} <span className="chip">{i.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evi-source-meta">No issues linked yet.</p>
      )}

      <h4 className="est-h">Integrations ({linksFrom.length})</h4>
      {linksFrom.map((l) => {
        const other = l.sourceApplicationId === app.id
          ? state.applications[l.targetApplicationId]
          : state.applications[l.sourceApplicationId]
        const direction = l.sourceApplicationId === app.id ? '→' : '←'
        return (
          <div key={l.id} className="ov-actions">
            <span>{direction} {other?.name ?? '(removed)'}</span>
            <span className="mono">{l.interface || 'interface not recorded'}</span>
            <span className="chip">{l.status}</span>
          </div>
        )
      })}
      {!linksFrom.length && <p className="evi-source-meta">No integrations recorded yet.</p>}

      {mayEdit && (
        !linking ? (
          <button className="btn" onClick={() => setLinking(true)}>Add integration…</button>
        ) : (
          <div className="ov-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Connects to…</option>
              {otherApps.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input
              value={interfaceName}
              onChange={(e) => setInterfaceName(e.target.value)}
              placeholder="Interface — OData export, Power Automate flow, …"
            />
            <input
              value={businessProcess}
              onChange={(e) => setBusinessProcess(e.target.value)}
              placeholder="What it's for — Order fulfilment, GL posting, …"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setLinking(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!targetId}
                onClick={() => {
                  const ok = onUpsertIntegrationLink(null, app.id, targetId, {
                    interface: interfaceName,
                    businessProcess,
                    status: INTEGRATION_STATUSES[0],
                  })
                  if (ok) {
                    setLinking(false)
                    setTargetId('')
                    setInterfaceName('')
                    setBusinessProcess('')
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        )
      )}

      <div className="ov-actions" style={{ marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
