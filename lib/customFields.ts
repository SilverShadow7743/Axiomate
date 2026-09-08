/**
 * A firm's own fields on an Issue — the minimal cut of Hive's Custom fields.
 * See `docs/plans/2026-09-08-custom-fields-design.md`.
 *
 * Four types only: Select, Text, Date, Number. Formula and Table lookup are deliberately
 * absent — a computed field would be this codebase's first *stored* derived value, against
 * the doctrine every other module enforces (values are computed at read time, never stored
 * as fact). That is a decision on its own, not a quiet exception carved in here.
 *
 * Scoped per project, like Hive's own model: a field is defined once, workspace-wide, then
 * opted into individual projects. `projectIds` empty means defined but not live anywhere yet
 * — the honest default, not an accident.
 */

export const CUSTOM_FIELD_TYPES = ['select', 'text', 'date', 'number'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export interface CustomFieldDef {
  id: string
  name: string
  fieldType: CustomFieldType
  /** Only present, and only meaningful, when fieldType is 'select'. */
  options: string[]
  /** Project-tier node ids this field is live on. Empty: defined, not yet assigned. */
  projectIds: string[]
  deletedAt: string | null
}

/**
 * Why this custom field definition cannot be saved, or null.
 *
 * Shape only — a Select with no options, a blank name. Whether a stored VALUE matches a
 * field's type is not checked here or at write time at all: the same lenient stance
 * `requiredSkills` already takes with a retired skill id, so a field retired out from under a
 * value degrades gracefully (the value just stops rendering) rather than orphaning old data
 * with a hard error.
 */
export function checkCustomFieldDef(
  f: Pick<CustomFieldDef, 'name' | 'fieldType' | 'options'>,
): string | null {
  if (!f.name.trim()) return 'A custom field needs a name.'
  if (!CUSTOM_FIELD_TYPES.includes(f.fieldType)) return 'That is not a field type this product knows.'
  if (f.fieldType === 'select' && f.options.filter((o) => o.trim()).length < 1) {
    return 'A select field needs at least one option.'
  }
  return null
}
