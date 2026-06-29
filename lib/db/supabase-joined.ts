// No longer needed — all joins are now written as SQL JOINs via postgres.js.
// Kept to avoid breaking any remaining imports; safe to delete once all files are migrated.

export function pickFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}
