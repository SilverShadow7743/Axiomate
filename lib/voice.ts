/**
 * Speaking to the assistant instead of typing at it.
 *
 * ---------------------------------------------------------------------------
 * What this is, and the line it does not cross
 *
 * A modality, not a second assistant. Speech becomes text, the text goes to the same chat
 * route, and the reply comes back as the same proposal cards a person accepts or rejects. There
 * is no path from a spoken sentence to a changed record that does not pass through somebody
 * reading what is about to happen and agreeing to it.
 *
 * That is not a nicety. Recognition is wrong often enough that it must be: "close OAPIL-14" and
 * "close OAPIL-40" differ by one syllable, and a delivery tool that acted on the difference
 * would be closing the wrong client's work on a bad line. Keeping the confirmation step means a
 * misheard word costs a correction rather than an incident — which is the same reason the
 * transcript is editable before it is sent.
 *
 * ---------------------------------------------------------------------------
 * Where it runs
 *
 * Entirely in the browser, using the Web Speech API. No audio is uploaded, stored, or sent
 * anywhere by this application — the only thing that leaves is the text, to the same endpoint
 * the keyboard already posts to.
 *
 * The honest caveat, and the interface says it too: on Chrome and Edge, `SpeechRecognition` is
 * a *cloud* service. The browser sends the audio to its vendor, and this application cannot see
 * or prevent that. Firefox does not implement it at all. A firm discussing client matters
 * should know both facts before switching this on, so they are stated where the switch is
 * rather than in a settings page nobody opens.
 */

/* ================================================================== *
 * Capability
 * ================================================================== */

/** What the browser will actually do, checked rather than assumed. */
export interface VoiceSupport {
  recognition: boolean
  synthesis: boolean
  /** Why not, in the user's terms — empty when everything works. */
  reason: string
}

type RecognitionCtor = new () => SpeechRecognitionLike

/**
 * The two vendor spellings, and neither exists on the server.
 *
 * Typed structurally rather than pulled from `lib.dom`, because the ambient types for this API
 * are inconsistent between TypeScript versions and a wrong global declaration is worse than a
 * local one that says exactly what is used.
 */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

export interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      length: number
      [alt: number]: { transcript: string; confidence: number }
    }
  }
}

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function detectSupport(): VoiceSupport {
  if (typeof window === 'undefined') {
    return { recognition: false, synthesis: false, reason: 'Voice needs a browser.' }
  }
  const recognition = Boolean(recognitionCtor())
  const synthesis = typeof window.speechSynthesis !== 'undefined'
  if (!recognition && !synthesis) {
    return { recognition, synthesis, reason: 'This browser has neither speech recognition nor speech synthesis.' }
  }
  if (!recognition) {
    return {
      recognition,
      synthesis,
      reason:
        'This browser cannot transcribe speech. Firefox has never implemented the API; Chrome, Edge and Safari do.',
    }
  }
  if (!synthesis) {
    return { recognition, synthesis, reason: 'This browser can listen but cannot read replies aloud.' }
  }
  return { recognition, synthesis, reason: '' }
}

/* ================================================================== *
 * Errors
 * ================================================================== */

/**
 * What went wrong, in words that say what to do about it.
 *
 * The raw codes are unhelpful to the point of being misleading — `not-allowed` and
 * `service-not-allowed` mean two different things and read identically — so each one is
 * translated at the boundary rather than shown.
 */
export function describeRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'The browser blocked the microphone. Allow it for this site and try again.'
    case 'service-not-allowed':
      return 'The browser refused its own speech service. This usually means the page is not on HTTPS.'
    case 'no-speech':
      return 'Nothing was heard. The microphone may be muted, or the wrong one may be selected.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Transcription needs the network, and the request failed. Type instead.'
    case 'aborted':
      return ''
    default:
      return `Transcription stopped: ${code}.`
  }
}

/* ================================================================== *
 * Transcript assembly
 * ================================================================== */

export interface Transcript {
  /** What has been recognised and will not change again. */
  settled: string
  /** What is still being revised as the speaker continues. */
  interim: string
}

export const EMPTY_TRANSCRIPT: Transcript = { settled: '', interim: '' }

/**
 * Fold a recognition event into the transcript.
 *
 * Kept out of the component and pure so the assembly rule is testable: results arrive as a
 * growing list where the tail is provisional, and a naive implementation that concatenates
 * every event repeats every word as it is revised.
 */
export function applyResult(current: Transcript, event: SpeechRecognitionEventLike): Transcript {
  let settled = current.settled
  let interim = ''
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i]
    const text = result[0]?.transcript ?? ''
    if (result.isFinal) settled = joinSpoken(settled, text)
    else interim = joinSpoken(interim, text)
  }
  return { settled, interim }
}

export function transcriptText(t: Transcript): string {
  return joinSpoken(t.settled, t.interim).trim()
}

/** Speech arrives without spacing decisions; this makes them once, in one place. */
function joinSpoken(a: string, b: string): string {
  const left = a.trim()
  const right = b.trim()
  if (!left) return right
  if (!right) return left
  return `${left} ${right}`
}

/**
 * Clean a transcript enough to be read back sensibly, and no further.
 *
 * Only two rules, both safe: capitalise the opening letter, and lift record ids the speaker
 * said as words back into the form the workspace uses. Anything cleverer — punctuation
 * inference, homophone correction — would be editing what somebody said, and the person is
 * about to read this and can do it better.
 */
export function tidy(text: string): string {
  const withIds = text.replace(
    /\b([a-z]{3,6})\s*[- ]\s*(\d{1,5})\b/gi,
    (m, code: string, num: string) => `${code.toUpperCase()}-${num}`,
  )
  return withIds.charAt(0).toUpperCase() + withIds.slice(1)
}

/**
 * What to read aloud from an assistant turn.
 *
 * Proposals are summarised as a count rather than read out field by field: a spoken list of
 * eleven changed fields is unlistenable, and the person has to look at the cards to accept them
 * anyway. Saying how many there are tells them to look.
 */
export function speakableReply(text: string, proposalCount: number): string {
  const trimmed = text.trim()
  if (!proposalCount) return trimmed
  const noun = proposalCount === 1 ? 'one change' : `${proposalCount} changes`
  return `${trimmed} I have drafted ${noun} for you to look at.`
}
