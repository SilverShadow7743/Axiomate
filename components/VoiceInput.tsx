'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_TRANSCRIPT,
  applyResult,
  describeRecognitionError,
  detectSupport,
  recognitionCtor,
  tidy,
  transcriptText,
  type SpeechRecognitionLike,
  type Transcript,
} from '@/lib/voice'

/**
 * Talking to the assistant.
 *
 * Three decisions, each with a rejected alternative worth naming.
 *
 * **Press to talk, not always listening.** A microphone that stays open in a room where
 * consultants discuss client matters is a liability, and a wake word would make it one
 * permanently. Holding a button is a small cost paid by the person who chose to pay it.
 *
 * **The transcript is editable before it is sent.** This is the affordance that matters most:
 * it turns a recognition error from a wrong action into a typo. The alternative — send on
 * silence — is faster and produces exactly the failure this cannot afford, because "OAPIL-14"
 * and "OAPIL-40" differ by one syllable.
 *
 * **Reading replies aloud is off until asked for.** Somebody in an open-plan office should not
 * be surprised by their laptop talking, and the preference is remembered for the session rather
 * than stored, because it is about where they are sitting today.
 */
export default function VoiceInput({
  onTranscript,
  onSpeakChange,
  disabled,
}: {
  /** Called when the person accepts what they said. The text goes to the chat route unchanged. */
  onTranscript: (text: string) => void
  /** Whether replies should be read aloud, raised so the panel can do the speaking. */
  onSpeakChange: (speak: boolean) => void
  disabled?: boolean
}) {
  const [support, setSupport] = useState(() => ({ recognition: false, synthesis: false, reason: '' }))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState<Transcript>(EMPTY_TRANSCRIPT)
  /** Set once the person edits: their words win over anything recognition says afterwards. */
  const [edited, setEdited] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [speak, setSpeak] = useState(false)

  const recognition = useRef<SpeechRecognitionLike | null>(null)

  // Detected in an effect rather than at render: the check touches `window`, and this component
  // is rendered on the server first.
  useEffect(() => setSupport(detectSupport()), [])

  const stop = useCallback(() => {
    recognition.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    setError('')
    setEdited(null)
    setTranscript(EMPTY_TRANSCRIPT)

    const r = new Ctor()
    r.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-GB' : 'en-GB'
    // Interim results are the whole point of showing the transcript as it forms; without them
    // the box stays empty until the speaker stops, which reads as broken.
    r.interimResults = true
    r.continuous = true
    r.maxAlternatives = 1

    r.onresult = (event) => setTranscript((prev) => applyResult(prev, event))
    r.onerror = (event) => {
      const message = describeRecognitionError(event.error)
      if (message) setError(message)
      setListening(false)
    }
    r.onend = () => setListening(false)
    r.onstart = () => setListening(true)

    recognition.current = r
    try {
      r.start()
    } catch {
      // Calling start() twice throws; treating it as "already listening" is the truthful answer.
      setListening(true)
    }
  }, [])

  useEffect(() => () => recognition.current?.abort(), [])

  const text = edited ?? tidy(transcriptText(transcript))
  const ready = text.trim().length > 0

  if (!support.recognition) {
    return (
      <div className="voice-bar">
        <span className="voice-unsupported">
          {support.reason || 'Checking whether this browser can transcribe speech…'}
        </span>
      </div>
    )
  }

  return (
    <div className="voice-bar">
      <div className="voice-controls">
        <button
          type="button"
          className={`btn voice-talk${listening ? ' listening' : ''}`}
          onClick={() => (listening ? stop() : start())}
          disabled={disabled}
          aria-pressed={listening}
        >
          <span className="voice-dot" aria-hidden="true" />
          {listening ? 'Stop' : 'Talk'}
        </button>

        {support.synthesis && (
          <label className="voice-speak">
            <input
              type="checkbox"
              checked={speak}
              onChange={(e) => {
                setSpeak(e.target.checked)
                onSpeakChange(e.target.checked)
              }}
            />
            <span>Read replies aloud</span>
          </label>
        )}

        <span className="voice-privacy">
          Transcribed by your browser. This application never stores or uploads audio — though on
          Chrome and Edge the browser itself sends it to its own service, which we cannot see or
          prevent.
        </span>
      </div>

      {(ready || listening) && (
        <div className="voice-draft">
          <label className="fld">
            <span className="fld-label">
              {listening ? 'Listening — say it, then read it back' : 'Check this before sending'}
            </span>
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setEdited(e.target.value)}
              placeholder="Your words appear here"
            />
          </label>
          <div className="voice-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!ready || disabled}
              onClick={() => {
                stop()
                onTranscript(text.trim())
                setTranscript(EMPTY_TRANSCRIPT)
                setEdited(null)
              }}
            >
              Send this
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                stop()
                setTranscript(EMPTY_TRANSCRIPT)
                setEdited(null)
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {error && <p className="ov-gate voice-error">{error}</p>}
    </div>
  )
}
