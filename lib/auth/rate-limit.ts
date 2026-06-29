"use server"

import sql from "@/lib/db"

const rateLimitStore = new Map<
  string,
  { attempts: number; lastAttempt: Date; locked: boolean; lockedUntil?: Date }
>()

interface RateLimitConfig {
  maxAttempts: number
  windowMs: number
  lockoutDurationMs?: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockoutDurationMs: 30 * 60 * 1000,
}

export async function checkRateLimit(
  identifier: string,
  action: string,
  config: Partial<RateLimitConfig> = {}
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }
  const key = `${identifier}:${action}`
  const now = new Date()

  let entry = rateLimitStore.get(key)
  if (!entry) {
    entry = { attempts: 0, lastAttempt: now, locked: false }
    rateLimitStore.set(key, entry)
  }

  if (entry.locked && entry.lockedUntil) {
    if (now < entry.lockedUntil) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.lockedUntil.getTime() - now.getTime()) / 1000) }
    }
    entry.locked = false
    entry.lockedUntil = undefined
    entry.attempts = 0
  }

  if (now.getTime() - entry.lastAttempt.getTime() > finalConfig.windowMs) {
    entry.attempts = 0
  }

  entry.attempts++
  entry.lastAttempt = now

  if (entry.attempts > finalConfig.maxAttempts) {
    entry.locked = true
    entry.lockedUntil = new Date(now.getTime() + (finalConfig.lockoutDurationMs ?? 30 * 60 * 1000))
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((finalConfig.lockoutDurationMs ?? 30 * 60 * 1000) / 1000) }
  }

  return { allowed: true, remaining: finalConfig.maxAttempts - entry.attempts }
}

export async function resetRateLimit(identifier: string, action: string): Promise<void> {
  rateLimitStore.delete(`${identifier}:${action}`)
}

export async function recordFailedLoginAttempt(email: string, ipAddress: string, reason: string): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (user_id, action, table_name, reason, ip_address)
      VALUES (${email}, 'login_failed', 'users', ${reason}, ${ipAddress})
    `
  } catch (error) {
    console.error("Failed to record login attempt:", error)
  }
}

export async function cleanupOldEntries(): Promise<void> {
  const now = new Date()
  const maxAge = 1000 * 60 * 60 * 24
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now.getTime() - entry.lastAttempt.getTime() > maxAge) {
      rateLimitStore.delete(key)
    }
  }
}
