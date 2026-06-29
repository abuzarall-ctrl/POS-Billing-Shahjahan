export function isSupabaseReady() {
  // Kept for backward-compat; always returns false — DB is now postgres.
  return false
}

export function isDatabaseReady() {
  return Boolean(process.env.DATABASE_URL)
}
