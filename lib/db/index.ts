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

function getConnection(): ReturnType<typeof postgres> {
  if (!globalThis._pgSql) {
    globalThis._pgSql = createConnection()
  }
  return globalThis._pgSql!
}

// Lazy proxy — connection only established on first query, not at import time.
// This allows the module to be imported during Next.js build without DATABASE_URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply(_target, _thisArg, args) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getConnection() as any)(...args)
  },
  get(_target, prop) {
    return getConnection()[prop as keyof ReturnType<typeof postgres>]
  },
})

export default sql
