"use client"
// Deprecated — Supabase browser client is no longer used.
// All data fetching happens through server actions backed by postgres.js.
export function createClient(): never {
  throw new Error("Supabase browser client is removed. Use server actions instead.")
}
