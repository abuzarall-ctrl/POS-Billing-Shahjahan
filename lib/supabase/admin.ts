// Deprecated — all DB access now goes through lib/db/index.ts (postgres.js)
// This file is kept only so TypeScript does not break files that have not been migrated yet.
export function createAdminClient(): never {
  throw new Error(
    "createAdminClient() is removed. Import sql from '@/lib/db' and use tagged-template queries."
  )
}
