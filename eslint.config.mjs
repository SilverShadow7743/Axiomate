import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import tsParser from '@typescript-eslint/parser'

/**
 * The accessibility gate — and only that.
 *
 * No style rules, no code-quality rules: this config exists so `npm run audit:a11y` fails
 * loudly on structural accessibility violations (interactions without keyboard
 * equivalents, controls without names, misused ARIA) beside the other audits. What a
 * static gate cannot judge — contrast, focus order — the verification checklist carries
 * as a manual keyboard walk. Widening this into a general linter is a separate decision.
 *
 * A rule downgraded here must carry the reason beside it; a bare `off` is forbidden by
 * the design (docs/plans/2026-08-23-a11y-gate-design.md).
 */
export default [
  {
    files: ['components/**/*.tsx', 'app/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    /*
     * `react-hooks` is registered but NOT enabled: the codebase carries a few inline
     * `eslint-disable react-hooks/...` comments written for editor tooling, and an
     * unregistered plugin turns each of those into a "definition not found" error that has
     * nothing to do with accessibility.
     */
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    /*
     * The react-hooks disable comments in the codebase are load-bearing documentation of
     * deliberate dependency choices; with the rule unenabled here they read as "unused"
     * and would add noise to an accessibility gate that is not about hooks.
     */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      /*
       * Every autoFocus in this codebase sits inside a just-opened dialog or inline editor,
       * where MOVING focus in is the accessible behaviour — the WAI-ARIA dialog pattern
       * requires it, and `useOverlay` restores focus on close. The rule guards against
       * autofocus on page load, which nothing here does.
       */
      'jsx-a11y/no-autofocus': 'off',
      /*
       * `AutoTextarea` is this codebase's controlled textarea; depth 4 admits the
       * label > span > b > text nesting the radio options use. Both are recognition
       * settings, not exemptions — a label with no control still fails.
       */
      'jsx-a11y/label-has-associated-control': [
        'error',
        { controlComponents: ['AutoTextarea'], depth: 4 },
      ],
    },
  },
]
