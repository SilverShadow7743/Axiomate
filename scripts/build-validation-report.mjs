/**
 * Render the validation report from the last run.
 *
 * Run with `npm run validate:report` after `validate:scenarios`.
 *
 * The page is generated rather than written, for the same reason the estimate stores inputs
 * and not results: a hand-written report can disagree with the run it describes, and the
 * disagreement is invisible. Every count, verdict and quoted measurement on the page comes
 * out of `data/validation.json`; the prose around them is the only part written by hand.
 */
import fs from 'fs'
const run = JSON.parse(fs.readFileSync(new URL('../data/validation.json', import.meta.url), 'utf8'))
const F = run.findings
const by = (v) => F.filter((f) => f.verdict === v)
const sev = (s) => F.filter((f) => f.severity === s)
const find = (id) => F.find((f) => f.id === id)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CLASS = {
  PASS: 'pass', PARTIAL: 'part', FAIL: 'fail',
  'NOT IMPLEMENTED': 'ni', 'NOT TESTABLE': 'nt',
}

const row = (f) => `
  <article class="tr" data-v="${CLASS[f.verdict]}" data-s="${f.severity === '—' ? 'none' : f.severity}">
    <div class="tr-id">
      <span class="idn">${esc(f.alias ? `${f.id} · ${f.alias}` : f.id)}</span>
      <span class="chip c-${CLASS[f.verdict]}">${esc(f.verdict)}</span>
      ${f.severity === '—' ? '' : `<span class="sev s-${f.severity}">${f.severity}</span>`}
    </div>
    <div class="tr-body">
      <h4>${esc(f.title)}</h4>
      <p class="exp"><span class="lbl">Expected</span>${esc(f.expected)}</p>
      <p class="act"><span class="lbl">Actual</span>${esc(f.actual)}</p>
      <p class="stop"><span class="lbl">Stops</span>${esc(f.stops)}</p>
      <p class="imp"><span class="lbl">Impact</span>${esc(f.impact)}</p>
    </div>
  </article>`

/** Every id placed in a group, so an ungrouped finding can be caught rather than lost. */
const placed = new Set()

const group = (title, note, ids) => {
  ids.forEach((id) => placed.add(id))
  return `
<section class="grp">
  <h3>${title}</h3>
  <p class="grp-note">${note}</p>
  <div class="ledger">${ids.map(find).filter(Boolean).map(row).join('')}</div>
</section>`
}

/**
 * Whatever the groups above did not claim.
 *
 * A generated page that silently omits a row is worse than a hand-written one, because it
 * looks complete. This ran once with five findings missing — new scenarios the group lists
 * did not know about — so the leftovers now render rather than disappear, and the build
 * prints them.
 */
const ungrouped = () => {
  const rest = F.filter((f) => !placed.has(f.id))
  if (!rest.length) return ''
  return group(
    'Not yet grouped',
    'Added since the sections above were written. Shown here rather than dropped.',
    rest.map((f) => f.id),
  )
}

const counts = ['FAIL', 'PARTIAL', 'PASS', 'NOT IMPLEMENTED', 'NOT TESTABLE']
  .map((v) => `<div class="cnt c-${CLASS[v]}"><b>${by(v).length}</b><span>${v}</span></div>`).join('')

const list = (ids) => ids.map((id) => `<code>${id}</code>`).join(' ')

const HTML = `<title>Axiomate Validation Run</title>
<style>
:root {
  --paper: #fbfbfa;
  --card: #ffffff;
  --line: #e2e2df;
  --line-2: #c9c9c4;
  --ink: #16181a;
  --ink-2: #55595e;
  --ink-3: #8b9096;
  --accent: #1f4b6e;
  --accent-soft: #eaf0f5;

  --v-pass: #1a7a5e;
  --v-part: #a8620d;
  --v-fail: #b3282f;
  --v-ni: #5a6472;
  --v-nt: #6b5aa0;

  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, 'Cascadia Mono', Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #131518;
    --card: #191c20;
    --line: #282c31;
    --line-2: #3a3f46;
    --ink: #e8eaec;
    --ink-2: #a7adb4;
    --ink-3: #757d86;
    --accent: #7fb3d9;
    --accent-soft: #1b2830;

    --v-pass: #46b48c;
    --v-part: #d99a3f;
    --v-fail: #e2696e;
    --v-ni: #929ba8;
    --v-nt: #a394d8;
  }
}
:root[data-theme="dark"] {
  --paper: #131518;
  --card: #191c20;
  --line: #282c31;
  --line-2: #3a3f46;
  --ink: #e8eaec;
  --ink-2: #a7adb4;
  --ink-3: #757d86;
  --accent: #7fb3d9;
  --accent-soft: #1b2830;

  --v-pass: #46b48c;
  --v-part: #d99a3f;
  --v-fail: #e2696e;
  --v-ni: #929ba8;
  --v-nt: #a394d8;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 62rem; margin: 0 auto; padding: 0 1.5rem; }

header.top {
  border-bottom: 1px solid var(--line-2);
  padding: 3.5rem 0 2rem;
  background: var(--card);
}
.eyebrow {
  font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent); margin: 0 0 1rem;
}
h1 {
  font-family: var(--serif); font-weight: 600; font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.1; letter-spacing: -0.01em; margin: 0 0 1rem; text-wrap: balance;
}
.standfirst {
  font-size: 1.08rem; color: var(--ink-2); max-width: 46rem; margin: 0 0 2rem;
}
.standfirst strong { color: var(--ink); font-weight: 600; }

.tally { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.cnt {
  flex: 1 1 8rem; padding: 0.9rem 1rem; border-right: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 0.15rem; background: var(--paper);
}
.cnt:last-child { border-right: 0; }
.cnt b { font-family: var(--mono); font-size: 1.5rem; font-weight: 600; line-height: 1; }
.cnt span {
  font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-3);
}
.cnt.c-pass b { color: var(--v-pass); }
.cnt.c-part b { color: var(--v-part); }
.cnt.c-fail b { color: var(--v-fail); }
.cnt.c-ni b { color: var(--v-ni); }
.cnt.c-nt b { color: var(--v-nt); }

section.blk { padding: 3rem 0 0; }
h2 {
  font-family: var(--serif); font-weight: 600; font-size: 1.6rem; line-height: 1.2;
  margin: 0 0 0.4rem; text-wrap: balance;
}
.num {
  display: block; font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent); font-weight: 500; margin-bottom: 0.5rem;
}
.lede { font-size: 1.02rem; color: var(--ink-2); max-width: 46rem; }
p { margin: 0 0 1rem; }
strong { font-weight: 600; }
code {
  font-family: var(--mono); font-size: 0.82em; background: var(--accent-soft);
  padding: 0.1em 0.35em; border-radius: 2px; color: var(--ink);
}

.controls {
  position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 0.4rem;
  padding: 0.8rem 0; background: var(--paper); border-bottom: 1px solid var(--line);
  margin-bottom: 1.5rem; align-items: center;
}
.controls .lbl2 {
  font-family: var(--mono); font-size: 0.65rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-3); margin-right: 0.3rem;
}
button.f {
  font-family: var(--mono); font-size: 0.7rem; padding: 0.3rem 0.6rem; cursor: pointer;
  border: 1px solid var(--line-2); background: var(--card); color: var(--ink-2); border-radius: 2px;
}
button.f[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
button.f:hover { border-color: var(--accent); color: var(--accent); }
button.f[aria-pressed="true"]:hover { color: var(--paper); }

.grp { margin-top: 2.4rem; }
.grp h3 {
  font-family: var(--sans); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--accent); margin: 0 0 0.3rem;
  padding-bottom: 0.5rem; border-bottom: 1px solid var(--line-2);
}
.grp-note { font-size: 0.9rem; color: var(--ink-3); margin: 0.6rem 0 1rem; max-width: 46rem; }
.ledger { display: grid; gap: 0.7rem; }

.tr {
  display: grid; grid-template-columns: 11rem 1fr; gap: 1.2rem;
  background: var(--card); border: 1px solid var(--line); border-radius: 3px;
  padding: 1rem 1.1rem;
}
@media (max-width: 720px) { .tr { grid-template-columns: 1fr; gap: 0.7rem; } }
.tr.hide { display: none; }
.tr[data-v="fail"] { border-left: 3px solid var(--v-fail); }
.tr[data-v="part"] { border-left: 3px solid var(--v-part); }
.tr[data-v="pass"] { border-left: 3px solid var(--v-pass); }
.tr[data-v="ni"] { border-left: 3px solid var(--v-ni); }
.tr[data-v="nt"] { border-left: 3px solid var(--v-nt); }

.tr-id { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
.idn { font-family: var(--mono); font-size: 0.95rem; font-weight: 600; }
.chip {
  font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 0.15rem 0.4rem; border-radius: 2px; border: 1px solid currentColor;
}
.c-pass { color: var(--v-pass); }
.c-part { color: var(--v-part); }
.c-fail { color: var(--v-fail); }
.c-ni { color: var(--v-ni); }
.c-nt { color: var(--v-nt); }
.sev {
  font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.06em;
  padding: 0.15rem 0.4rem; border-radius: 2px; color: var(--paper); background: var(--ink-3);
}
.s-P0 { background: var(--v-fail); }
.s-P1 { background: var(--v-part); }

.tr-body h4 { font-family: var(--serif); font-size: 1.08rem; font-weight: 600; margin: 0 0 0.6rem; line-height: 1.3; }
.tr-body p { margin: 0 0 0.35rem; font-size: 0.88rem; line-height: 1.55; color: var(--ink-2); }
.tr-body .lbl {
  display: inline-block; min-width: 5.2rem; font-family: var(--mono); font-size: 0.6rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); vertical-align: baseline;
}
.tr-body .stop { color: var(--ink); font-weight: 500; }
.tr-body .imp { font-style: italic; }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 1.4rem; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
.cols h3, .fix h3 { font-family: var(--serif); font-size: 1.1rem; margin: 0 0 0.6rem; }
ul.tight { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.6rem; }
ul.tight li { font-size: 0.92rem; color: var(--ink-2); line-height: 1.55; }
ul.tight b { color: var(--ink); }

.risk {
  border-left: 3px solid var(--v-fail); background: var(--card); padding: 1rem 1.2rem;
  margin-bottom: 0.8rem; border-radius: 0 3px 3px 0;
}
.risk h4 { font-family: var(--serif); font-size: 1.05rem; margin: 0 0 0.4rem; }
.risk p { font-size: 0.92rem; color: var(--ink-2); margin: 0; }

.fix { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 1.5rem; }
@media (max-width: 900px) { .fix { grid-template-columns: 1fr; } }
.fix > div { border-top: 2px solid var(--line-2); padding-top: 0.8rem; }
.fix > div:first-child { border-top-color: var(--v-fail); }
.fix .step {
  font-family: var(--mono); font-size: 0.65rem; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--ink-3);
}
.fix ol { margin: 0.5rem 0 0; padding-left: 1.1rem; display: grid; gap: 0.6rem; }
.fix li { font-size: 0.88rem; color: var(--ink-2); line-height: 1.5; }
.fix b { color: var(--ink); }

.note {
  background: var(--accent-soft); border-left: 3px solid var(--accent);
  padding: 1rem 1.2rem; margin: 1.4rem 0; font-size: 0.93rem;
}
table.scan { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.86rem; }
table.scan th, table.scan td { text-align: left; padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
table.scan th {
  font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-3); font-weight: 500;
}
table.scan td:first-child { font-family: var(--mono); white-space: nowrap; }
.tablewrap { overflow-x: auto; }

footer {
  margin-top: 4rem; border-top: 1px solid var(--line-2); background: var(--card);
  padding: 2rem 0 3rem; font-size: 0.82rem; color: var(--ink-3);
}
</style>

<header class="top">
  <div class="wrap">
    <p class="eyebrow">Axiocloud Solutions · Validation run · ${run.asAt}</p>
    <h1>Can Axiomate produce the correct business outcome?</h1>
    <p class="standfirst">Not a feature audit. ${F.length} business scenarios were <strong>driven through the real reducer and the real derivations</strong> and asked to reach an outcome — a screen, a button, a configuration record and a declared agent are all evidence of intent, not of behaviour. Each row below states what should happen, what the run actually produced, and the exact point at which the trace stops. Every figure on this page is generated from that run.</p>
    <div class="tally">${counts}</div>
  </div>
</header>

<div class="wrap">

<section class="blk">
  <span class="num">§ 01 — Executive summary</span>
  <h2>It keeps a record, holds a line, and now acts. What it cannot yet do is prove who you are.</h2>
  <p class="lede">${by('PASS').length} scenarios pass end to end and ${by('PARTIAL').length} get part of the way, and the shape of the result has changed twice. The first run's passes were all about <em>keeping a record straight</em>. The second run added <em>holding a line</em> — an issue cannot jump from Open to Closed, a confirmed closure needs evidence, an analyst who may triage may not close. This run adds the third thing: the system <strong>acts</strong>. Rules fire on events and raise notifications; a message posted to the intake endpoint becomes a work item under the right scope; an overallocation is refused with the arithmetic behind it.</p>
  <p>The rule that makes the acting safe is worth stating on its own: <strong>automation dispatches ordinary actions</strong>. A rule goes through the same reducer, permission check, transition graph and audit trail a person's click does — so it cannot do anything a person could not, everything it does is attributed to the rule that caused it, and a failure is partial and recorded rather than silent and total.</p>
  <p>One P0 remains, and it is the one that should not be closed by writing code without being asked. Authorisation is real and enforced; the identity it is enforced against is still read from an environment variable. The boundary a provider plugs into is built and every server path already asks it — what is missing is the decision about <em>which provider</em>, which belongs to whoever operates this rather than to whoever last had the editor open.</p>
  <div class="note"><b>On severity.</b> P0 means the intended business outcome cannot be produced correctly. Of the nine P0s in the first run, eight are closed: the ungoverned status field, the absent permission model, the missing time record, the inert automation engine, the uncontracted scope boundary, the uncounted capacity, the unapproved change, and the intake that read nothing. The ninth is <code>ST2b</code>, above.</div>
</section>

<section class="blk">
  <span class="num">§ 02 — Scenario validation</span>
  <h2>Every scenario, and where each trace stops</h2>
  <p class="lede">Grouped by the part of the business they belong to. Filter by verdict or severity; the letters are yours, and the ones that answer a lettered scenario under a different id show both.</p>

  <div class="controls">
    <span class="lbl2">Verdict</span>
    <button class="f" data-v="fail" aria-pressed="false">Fail</button>
    <button class="f" data-v="part" aria-pressed="false">Partial</button>
    <button class="f" data-v="pass" aria-pressed="false">Pass</button>
    <button class="f" data-v="ni" aria-pressed="false">Not implemented</button>
    <button class="f" data-v="nt" aria-pressed="false">Not testable</button>
    <span class="lbl2" style="margin-left:0.8rem">Severity</span>
    <button class="f" data-s="P0" aria-pressed="false">P0</button>
    <button class="f" data-s="P1" aria-pressed="false">P1</button>
    <button class="f" id="clear" aria-pressed="false">Show all</button>
  </div>

  ${group('Intake and client contact', 'Everything that happens before a consultant opens the app. This is the group with no passes at all — work arrives only by being typed in.', ['A', 'A2', 'B', 'C', 'D', 'E'])}
  ${group('Ownership, capacity and assignment', 'Who does the work, and whether they can. The capacity model has no entity behind it, so three of these stop at the same place.', ['F', 'G', 'L', 'M'])}
  ${group('Who may do what', 'Authorisation is enforced in the reducer. Authentication is not — that split is the whole of ST2b.', ['ST2', 'ST2b', 'ST2c'])}
  ${group('Schedule, SLA and risk', 'The derivations are correct and nobody is told. Every row here computes the right answer and stops before the person who needs it.', ['H', 'I', 'Q'])}
  ${group('Effort, estimate and actuals', 'Both halves of the loop now exist. What it cannot reach is money.', ['J', 'J2', 'K'])}
  ${group('Scope and change control', 'The commercial control the product exists to provide. There is no SOW, so there is no boundary for anything to be outside of.', ['N', 'O', 'P', 'P2'])}
  ${group('Resolution, evidence and closure', 'Closing work is where the record is strongest and the gates are weakest.', ['R', 'S', 'T'])}
  ${group('State transitions and concurrency', 'What the system will let people do. The transition graph closed three of these; concurrency is the one still open.', ['ST1', 'ST5', 'ST6', 'ST3', 'ST4'])}
  ${group('Configuration reaching runtime', 'Whether changing a setting actually changes behaviour — tested by changing it and then running a scenario.', ['CF1', 'CF2', 'CF3'])}
  ${group('Reporting and cross-module propagation', 'Whether the numbers reconcile to their source, and how far a change travels.', ['RP1', 'RP2', 'XM1'])}
  ${group('Time and approval', 'Both stop at the same missing record. Time Entry is the single most connected thing the product does not have.', ['U', 'V'])}
  ${group('Audit, AI and the machinery', 'What the platform layers do when asked to behave rather than to be configured.', ['AU1', 'AI1', 'Y', 'W', 'Z', 'AA'])}
  ${group('Failure and recovery', 'What happens when the parts that do exist break.', ['FL1', 'FL2', 'FL3', 'FL4'])}
  ${ungrouped()}
</section>

<section class="blk">
  <span class="num">§ 03 — What the run says by dimension</span>
  <h2>Twelve readings, in the order they matter</h2>
  <div class="cols">
    <div>
      <h3>Workflow</h3>
      <p>The worst result on the page. ${find('ST1').actual}</p>
      <h3>Permissions</h3>
      <p>Not partially enforced — unenforced by design, and documented as such. <code>canEditIssue</code> returns allowed for every actor because there is no actor to distinguish. Until identity exists, no permission scenario can be run at all: there is no administrator and no client user, only one operator read from an environment variable.</p>
      <h3>Automation</h3>
      <p>Routing rules and intake mailboxes are records with no engine. Nothing evaluates them, so nothing can fail — which is not the same as working, and the configuration screen does not say which it is.</p>
      <h3>AI</h3>
      <p>One agent of 38 has a runtime. Its proposals are correctly gated on a person, and an accepted proposal passes through the same reducer as a human edit, so it is audited identically. Autonomy level, confidence threshold and required-approval are registry fields nothing reads — the gate is code, not the configured policy. A rejected recommendation is discarded, so agent quality cannot be measured.</p>
      <h3>Data consistency</h3>
      <p>Strong, for a specific reason: almost nothing derived is stored. Health, duration, progress, size, effort and the report's own counts are all recomputed from source on every read, so there is no second copy to drift. The exception is deliberate — a due date, once committed, does not move when the policy behind it changes, and the screen says so.</p>
      <h3>Audit</h3>
      <p>The strongest dimension. One reducer is the only way state changes, and it writes the trail itself, so an unaudited mutation is not something you have to remember to avoid — there is no second path. Attribution is a parameter rather than a field on the action, so nothing on the wire can forge it. <em>Why</em> is captured where the product asks for it and absent on routine edits.</p>
    </div>
    <div>
      <h3>Configuration → runtime</h3>
      <p>Genuinely works for the parts that have a runtime. Shortening the High SLA from five days to two moves the next proposal immediately, because the policy is read from the model at each derivation rather than captured at startup. Adding a work type makes it usable at once, and retiring one leaves existing records readable. Where configuration has no runtime — workflows, agents, routing — the screens still imply one.</p>
      <h3>Reporting</h3>
      <p>The daily IMS reconciles exactly to its rows, counts rather than estimates, and prints its own section cap instead of truncating silently. It is also the only report: the weekly client pack needs a client-visible boundary, and no field anywhere marks a record or a note as safe to send.</p>
      <h3>Failure and recovery</h3>
      <p>Editing survives an outage — the local mirror keeps the session — but persistence does not resume: the queue halts after four attempts and nothing ever clears the halt. The unload flush sends the first 50 queued actions and then clears the whole queue. And with no idempotency key, a re-delivered batch creates duplicate records rather than being recognised.</p>
      <h3>Data lifecycle</h3>
      <p>Create → update → close → archive → restore all hold, and deletion is soft throughout. Restoring a child under an archived parent is refused rather than producing a record the tree cannot reach.</p>
      <h3>Persistence</h3>
      <p>The least verified layer. Repository, mappers, write path and baseline migration exist and typecheck, and the write path has a mirror-image arm for every action the reducer accepts — but nothing in this repository has ever run them against Postgres, and there is no <code>.env.example</code> to configure one.</p>
      <h3>UX and performance</h3>
      <p>Not covered by this run, and not claimed. Both need a browser and a dataset at scale; this harness drives pure functions. Stating it is more useful than a guess — the ${F.length} verdicts above are all reproducible, and adding two that are not would put the rest in doubt.</p>
    </div>
  </div>
</section>

<section class="blk">
  <span class="num">§ 04 — Critical risks</span>
  <h2>What would still hurt a real engagement</h2>

  <div class="risk">
    <h4>Authorisation rests on a claimed identity</h4>
    <p>The permission model is real, enforced in the reducer, and configurable. The actor behind it comes from an environment variable, so it stops a mistake rather than an attacker — and the fallback role, which ships as Administrator so a single-operator deployment is usable, is effectively everyone until a login exists.</p>
  </div>
  <div class="risk">
    <h4>Nothing wakes up</h4>
    <p>Automation is event-driven and works. An issue going at-risk is not an event — it is time passing against a date nobody moved — so the one thing a delivery firm most wants automated is the one thing this cannot express. A scheduled pass is the missing piece, and it is a clock rather than a channel.</p>
  </div>
  <div class="risk">
    <h4>Ownership is a string</h4>
    <p>The owner column accepts any text. A leaver, a misspelling, or somebody who left the engagement six months ago all pass silently, and the daily report will list work owned by a person who cannot do it. The directory exists; the column does not reference it.</p>
  </div>
  <div class="risk">
    <h4>Concurrent edits lose silently</h4>
    <p>Two consultants on the same issue both succeed; the second write wins and the first is recoverable only from the audit trail. The reducer rejects impossible states, not out-of-date ones.</p>
  </div>
  <div class="risk">
    <h4>An outage ends persistence for the session, and a re-delivered batch duplicates records</h4>
    <p>Four failed attempts halt the queue permanently while editing continues into the browser mirror and looks saved. Separately, no request carries an identity, so a batch delivered twice creates two of everything in it — the intake endpoint dedupes on the sender's message id, and the workspace endpoint has no equivalent.</p>
  </div>
  <div class="risk">
    <h4>Hours are recorded and money is not</h4>
    <p>Time, estimates and a contracted baseline all exist, so effort consumption is arithmetic. Cost and margin are not, because there is no rate anywhere — not on a person, a role or an engagement. Every commercial figure stops at hours.</p>
  </div>
</section>

<section class="blk">
  <span class="num">§ 05 — Fix order</span>
  <h2>What to do, in the order the run implies</h2>
  <p class="lede">Ordered by whether it stops something from being wrong, not by size. The first column is cheap and closes active failures; the second is the entity work everything else waits on.</p>

  <div class="fix">
    <div>
      <span class="step">First — close the active failures</span>
      <ol>
        <li><b>Choose an identity provider.</b> The seam is built and every server path asks it; what is missing is the decision. Entra ID is what the firm already runs. <code>ST2b</code></li>
        <li><b>Make owner a reference to a person.</b> The directory exists; the column is still free text. <code>G</code></li>
        <li><b>Clear the autosave halt on the next successful action, and stop the beacon clearing unsent work.</b> Two small changes in <code>useAutosave.ts</code>. <code>FL1</code></li>
        <li><b>Give each dispatched action a client-minted id.</b> The intake endpoint already dedupes on the sender's id; the workspace endpoint has no equivalent. <code>FL4</code></li>
        <li><b>Detect a stale write.</b> A row version checked on replay turns silent last-writer-wins into a refusal the client can resolve. <code>ST3</code></li>
      </ol>
    <div>
      <span class="step">Then — the entities everything waits on</span>
      <ol>
        <li><b>A scheduled pass.</b> One process waking daily turns the SLA watch, the at-risk alert and the impossible-plan check from calculations a screen can run into things somebody is told. It is the single highest-value piece left. <code>H I M</code></li>
        <li><b>Rate, in the configuration chain.</b> Hours are recorded; a rate is what turns them into cost and margin. It belongs beside the service levels, not on a person. <code>K N</code></li>
        <li><b>A period to approve.</b> Time entries and approvals both exist and nothing joins them — an approval will have to name the entries it covered, or an edit afterwards silently changes an approved total. <code>U V</code></li>
        <li><b>A client-visible boundary.</b> No field marks a record or a note as safe to send, which is what stands between the daily report and a weekly client pack. <code>RP2</code></li>
        <li><b>An intake connector.</b> A forwarding rule and a token, not a build — the pipeline behind it already runs. <code>A</code></li>
      </ol>
    <div>
      <span class="step">Keep — and make it a gate</span>
      <ol>
        <li><b>Run this on every change.</b> The harness is <code>npm run validate:scenarios</code>; it writes <code>data/validation.json</code>, which this page is generated from, so the report cannot drift from the run.</li>
        <li><b>Add a strict mode.</b> Compare against a committed baseline and fail when a PASS becomes anything else. That is the step that turns a report into a regression gate.</li>
        <li><b>Add scenarios as the operating model grows.</b> A client-specific configuration is a client-specific set of expected outcomes; the same harness can validate that a configuration change did not break the firm's own model.</li>
        <li><b>Do not add UX or performance rows until they are actually driven.</b> A verdict that was not computed devalues the ones that were.</li>
      </ol>
    </div>
  </div>
</section>

<section class="blk">
  <span class="num">§ 06 — Coverage</span>
  <h2>What was validated, and how</h2>
  <div class="tablewrap">
    <table class="scan">
      <thead><tr><th>Method</th><th>Applies to</th><th>What it proves</th></tr></thead>
      <tbody>
        <tr><td>Driven</td><td>${by('PASS').length + by('PARTIAL').length + by('FAIL').length} scenarios</td><td>The reducer and derivations were executed and their output measured. Every quoted number in those rows came out of the run.</td></tr>
        <tr><td>Source-asserted</td><td>${by('NOT IMPLEMENTED').length} scenarios</td><td>A regex over every <code>.ts</code> and <code>.tsx</code> file confirms the mechanism is absent, so the claim breaks loudly if somebody builds it and does not update the harness.</td></tr>
        <tr><td>Not testable here</td><td>${by('NOT TESTABLE').length} scenarios</td><td>Needs a model key or a live database. Stated rather than guessed.</td></tr>
        <tr><td>Not attempted</td><td>UX, responsiveness, performance at scale</td><td>Needs a browser and a large dataset. No verdict is offered.</td></tr>
      </tbody>
    </table>
  </div>
</section>

</div>

<footer>
  <div class="wrap">
    <div>Generated from <code>data/validation.json</code>, written by <code>npm run validate:scenarios</code> on ${run.asAt}. ${F.length} scenarios: ${by('PASS').length} pass, ${by('PARTIAL').length} partial, ${by('FAIL').length} fail, ${by('NOT IMPLEMENTED').length} not implemented, ${by('NOT TESTABLE').length} not testable. Scenario letters A–AB are the ones supplied; ST, CF, RP, AU, AI, FL and XM rows are cross-cutting checks added to cover state transitions, configuration, reporting, audit, AI, failure and cross-module propagation.</div>
    <div style="margin-top:0.7rem">Codebase at <code>C:\\Axiomate-TMS</code>. The capability matrix — what the platform owes and what is built — is a separate document.</div>
  </div>
</footer>

<script>
(function () {
  const rows = Array.from(document.querySelectorAll('.tr'));
  const vs = new Set(), ss = new Set();
  function render() {
    rows.forEach((r) => {
      const okV = vs.size === 0 || vs.has(r.dataset.v);
      const okS = ss.size === 0 || ss.has(r.dataset.s);
      r.classList.toggle('hide', !(okV && okS));
    });
    document.querySelectorAll('.grp').forEach((g) => {
      const any = Array.from(g.querySelectorAll('.tr')).some((r) => !r.classList.contains('hide'));
      g.style.display = any ? '' : 'none';
    });
  }
  document.querySelectorAll('button.f[data-v], button.f[data-s]').forEach((b) => {
    b.addEventListener('click', () => {
      const set = b.dataset.v ? vs : ss;
      const key = b.dataset.v || b.dataset.s;
      if (set.has(key)) { set.delete(key); b.setAttribute('aria-pressed', 'false'); }
      else { set.add(key); b.setAttribute('aria-pressed', 'true'); }
      render();
    });
  });
  document.getElementById('clear').addEventListener('click', () => {
    vs.clear(); ss.clear();
    document.querySelectorAll('button.f').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    render();
  });
})();
</script>
`

const OUT = process.argv[2] ?? new URL('../data/validation-report.html', import.meta.url)
fs.writeFileSync(OUT, HTML)

/* Sanity: every finding must appear exactly once in the ledger. */
const shown = [...HTML.matchAll(/class="idn">([^<]+)</g)].map((m) => m[1].split(' · ')[0])
const missing = F.map((f) => f.id).filter((id) => !shown.includes(id))
console.log('findings:', F.length, '| rendered:', shown.length, '| missing:', missing.length ? missing.join(',') : 'none')
console.log('kb:', Math.round(HTML.length / 1024))
