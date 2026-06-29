import postgres from "postgres"

declare global {
  // eslint-disable-next-line no-var
  var _pgSql: ReturnType<typeof postgres> | undefined
}

function createConnection() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL environment variable is not set")
  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  })
}

// Reuse connection across hot-reloads in dev
const sql = globalThis._pgSql ?? createConnection()
if (process.env.NODE_ENV !== "production") globalThis._pgSql = sql

export default sql
