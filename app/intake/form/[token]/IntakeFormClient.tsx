'use client'

import { useState } from 'react'

/**
 * The form itself. Fixed, generic fields — the firm's own vocabulary stays server-side, where
 * classification already lives. Urgency is three plain words that map to severity on the
 * server; what the sender states is recorded as stated.
 */
export default function IntakeFormClient({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState<'urgent' | 'normal' | 'low'>('normal')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  const ready = name.trim() && email.trim() && subject.trim() && description.trim() && !busy

  const submit = async () => {
    setBusy(true)
    setOutcome(null)
    try {
      const res = await fetch('/api/intake/form', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, name, email, subject, description, urgency }),
      })
      const body = (await res.json()) as { ok: boolean; reference?: string; error?: string }
      if (body.ok && body.reference) {
        setOutcome({ ok: true, text: `Received — reference ${body.reference}. Quote it in any follow-up.` })
        setSubject('')
        setDescription('')
        setUrgency('normal')
      } else {
        setOutcome({ ok: false, text: body.error ?? 'The submission could not be sent.' })
      }
    } catch {
      setOutcome({ ok: false, text: 'The submission could not be sent. Check your connection and try again — nothing was lost.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pubform">
      <div className="pubform-card">
        <h1>Raise a request</h1>
        <p className="pubform-sub">
          What you send here is filed straight into the delivery team’s register and picked up
          from there. You’ll get a reference to quote in any follow-up.
        </p>

        <label className="pubform-fld">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="pubform-fld">
          <span>Your email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="pubform-fld">
          <span>Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="One line saying what this is about"
          />
        </label>
        <label className="pubform-fld">
          <span>What happened</span>
          <textarea
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What you were doing, what you expected, and what you saw instead. Error messages word for word help most."
          />
        </label>

        <fieldset className="pubform-urgency">
          <legend>How urgent is this?</legend>
          {(
            [
              ['urgent', 'Urgent — work is stopped'],
              ['normal', 'Normal'],
              ['low', 'Low — when there is time'],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="urgency"
                value={value}
                checked={urgency === value}
                onChange={() => setUrgency(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {outcome && (
          <p className={outcome.ok ? 'pubform-ok' : 'pubform-err'} role="status">
            {outcome.text}
          </p>
        )}

        <button className="pubform-send" disabled={!ready} onClick={submit}>
          {busy ? 'Sending…' : 'Send it'}
        </button>
      </div>
    </main>
  )
}
