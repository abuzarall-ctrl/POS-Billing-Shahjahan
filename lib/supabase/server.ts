// Deprecated — all DB access now goes through lib/db/index.ts (postgres.js)
// This file is kept only so TypeScript does not break files that have not been migrated yet.
export function createClient(): never {
  throw new Error(
    "createClient() is removed. Import sql from '@/lib/db' and use tagged-template queries."
  )
}
