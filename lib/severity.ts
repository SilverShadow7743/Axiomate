import type { Severity } from './types'

/**
 * A shape distinct from color, alongside the text label already shown everywhere severity
 * renders. Schedule health carries the same discipline on the Gantt bars (`!`/`⌧`/`✓`); this
 * gives severity — until now color-and-text-only wherever it appeared as a badge — the same
 * non-color signal, so it reads under color-vision deficiency exactly as it does to everyone
 * else. One definition, shared by every render site, so the mapping can't drift between them.
 */
export function severityGlyph(severity: Severity): string {
  switch (severity) {
    case 'High':
      return '▲'
    case 'Medium':
      return '●'
    case 'Low':
      return '–'
  }
}
