"use server"

import sql from "@/lib/db"

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "export"
  | "login"
  | "login_failed"
  | "logout"
  | "permission_change"
  | "bulk_operation"

export interface AuditLogEntry {
  userId: string
  action: AuditAction
  tableName: string
  recordId?: string
  changes?: Record<string, { from: unknown; to: unknown }>
  reason?: string
  ipAddress?: string
  userAgent?: string
}

export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (user_id, action, table_name, record_id, changes, reason, ip_address, user_agent)
      VALUES (
        ${entry.userId},
        ${entry.action},
        ${entry.tableName},
        ${entry.recordId ?? null},
        ${entry.changes ? JSON.stringify(entry.changes) : null},
        ${entry.reason ?? null},
        ${entry.ipAddress ?? null},
        ${entry.userAgent ?? null}
      )
    `
  } catch (error) {
    console.error("Failed to record audit log:", error)
  }
}

export async function logLogin(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
  await recordAuditLog({ userId, action: "login", tableName: "users", recordId: userId, ipAddress, userAgent })
}

export async function logFailedLogin(email: string, reason: string, ipAddress?: string): Promise<void> {
  await recordAuditLog({ userId: email, action: "login_failed", tableName: "users", reason, ipAddress })
}

export async function logLogout(userId: string, ipAddress?: string): Promise<void> {
  await recordAuditLog({ userId, action: "logout", tableName: "users", recordId: userId, ipAddress })
}

export async function logCreate(
  userId: string,
  tableName: string,
  recordId: string,
  recordData: Record<string, unknown>
): Promise<void> {
  await recordAuditLog({ userId, action: "create", tableName, recordId, changes: { created: { from: null, to: recordData } } })
}

export async function logUpdate(
  userId: string,
  tableName: string,
  recordId: string,
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>
): Promise<void> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const allKeys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)])
  for (const key of allKeys) {
    const before = beforeData[key]
    const after = afterData[key]
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[key] = { from: before, to: after }
    }
  }
  if (Object.keys(changes).length > 0) {
    await recordAuditLog({ userId, action: "update", tableName, recordId, changes })
  }
}

export async function logDelete(
  userId: string,
  tableName: string,
  recordId: string,
  deletedData?: Record<string, unknown>
): Promise<void> {
  await recordAuditLog({
    userId,
    action: "delete",
    tableName,
    recordId,
    changes: deletedData ? { deleted: { from: deletedData, to: null } } : undefined,
  })
}

export async function logExport(
  userId: string,
  tableName: string,
  format: string,
  recordCount: number,
  reason?: string
): Promise<void> {
  await recordAuditLog({
    userId,
    action: "export",
    tableName,
    reason: `Exported ${recordCount} records in ${format} format${reason ? ": " + reason : ""}`,
  })
}

export async function logPermissionChange(
  userId: string,
  targetUserId: string,
  oldPermissions: string[],
  newPermissions: string[],
  reason?: string
): Promise<void> {
  await recordAuditLog({
    userId,
    action: "permission_change",
    tableName: "user_privileges",
    recordId: targetUserId,
    changes: { privileges: { from: oldPermissions, to: newPermissions } },
    reason,
  })
}

export async function logBulkOperation(
  userId: string,
  tableName: string,
  operationType: "update" | "delete" | "import",
  recordCount: number,
  reason?: string
): Promise<void> {
  await recordAuditLog({
    userId,
    action: "bulk_operation",
    tableName,
    reason: `Bulk ${operationType} of ${recordCount} records${reason ? ": " + reason : ""}`,
  })
}

export async function getAuditLogs(
  userId: string,
  filters?: {
    action?: AuditAction
    tableName?: string
    dateFrom?: string
    dateTo?: string
    limit?: number
    offset?: number
  }
) {
  const limit = filters?.limit ?? 50
  const offset = filters?.offset ?? 0

  const rows = await sql`
    SELECT * FROM audit_logs
    WHERE user_id = ${userId}
      ${filters?.action ? sql`AND action = ${filters.action}` : sql``}
      ${filters?.tableName ? sql`AND table_name = ${filters.tableName}` : sql``}
      ${filters?.dateFrom ? sql`AND created_at >= ${filters.dateFrom}` : sql``}
      ${filters?.dateTo ? sql`AND created_at <= ${filters.dateTo}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { error: null, data: rows }
}

export async function getAuditSummary(userId: string) {
  const rows = await sql`
    SELECT action, COUNT(*) as count FROM audit_logs
    WHERE user_id = ${userId}
    GROUP BY action
  `
  const summary: Record<string, number> = {}
  rows.forEach((row) => { summary[row.action as string] = Number(row.count) })
  return { error: null, data: summary }
}
