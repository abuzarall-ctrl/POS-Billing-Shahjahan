"use server"

import sql from "@/lib/db"
import { PosUser, CreateSubUserInput, UpdateSubUserInput, UserPrivileges } from "@/lib/types/user"
import bcrypt from "bcryptjs"

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function authenticateUser(email: string, password: string): Promise<PosUser | null> {
  const rows = await sql`
    SELECT * FROM pos_users
    WHERE email = ${email.toLowerCase().trim()} AND is_active = true
    LIMIT 1
  `
  const data = rows[0] as PosUser | undefined
  if (!data) return null

  const isValid = await verifyPassword(password, data.password_hash)
  if (!isValid) return null

  return data
}

export async function getUserById(userId: string): Promise<PosUser | null> {
  const rows = await sql`
    SELECT * FROM pos_users
    WHERE id = ${userId} AND is_active = true
    LIMIT 1
  `
  const data = rows[0] as PosUser | undefined
  if (!data) return null

  const user = data as PosUser
  user.effectiveUserId = user.parent_user_id ?? user.id
  return user
}

export async function getUserByEmail(email: string): Promise<PosUser | null> {
  const rows = await sql`
    SELECT * FROM pos_users
    WHERE email = ${email.toLowerCase().trim()}
    LIMIT 1
  `
  return (rows[0] as PosUser) ?? null
}

export async function createSubUser(
  parentUserId: string,
  input: CreateSubUserInput
): Promise<{ success: boolean; user?: PosUser; error?: string }> {
  const parentUser = await getUserById(parentUserId)
  if (!parentUser || parentUser.role !== "pos_user") {
    return { success: false, error: "Only admin users can create sub-users" }
  }

  const existingUser = await getUserByEmail(input.email)
  if (existingUser) {
    return { success: false, error: "Email already exists" }
  }

  const passwordHash = await hashPassword(input.password)

  const rows = await sql`
    INSERT INTO pos_users (email, password_hash, role, parent_user_id, name, privileges, is_active)
    VALUES (
      ${input.email.toLowerCase().trim()},
      ${passwordHash},
      'sub_pos_user',
      ${parentUserId},
      ${input.name || null},
      ${JSON.stringify(input.privileges)},
      true
    )
    RETURNING *
  `
  const data = rows[0] as PosUser | undefined
  if (!data) return { success: false, error: "Failed to create user" }

  return { success: true, user: data }
}

export async function updateSubUser(
  parentUserId: string,
  userId: string,
  input: UpdateSubUserInput
): Promise<{ success: boolean; user?: PosUser; error?: string }> {
  const parentUser = await getUserById(parentUserId)
  if (!parentUser || parentUser.role !== "pos_user") {
    return { success: false, error: "Only admin users can update sub-users" }
  }

  const userToUpdate = await getUserById(userId)
  if (!userToUpdate || userToUpdate.parent_user_id !== parentUserId) {
    return { success: false, error: "User not found or access denied" }
  }

  const sets: string[] = []
  const values: Record<string, unknown> = {}

  if (input.email !== undefined) {
    const existing = await getUserByEmail(input.email)
    if (existing && existing.id !== userId) {
      return { success: false, error: "Email already exists" }
    }
    values.email = input.email.toLowerCase().trim()
  }
  if (input.password !== undefined) values.password_hash = await hashPassword(input.password)
  if (input.name !== undefined) values.name = input.name || null
  if (input.privileges !== undefined) values.privileges = JSON.stringify(input.privileges)
  if (input.is_active !== undefined) values.is_active = input.is_active

  if (Object.keys(values).length === 0) {
    return { success: true, user: userToUpdate }
  }

  const setClauses = Object.keys(values)
    .map((k) => `${k} = $${sets.push(k)}`)
    .join(", ")

  // Build update dynamically using postgres.js helpers
  const rows = await sql`
    UPDATE pos_users SET ${sql(values as Record<string, unknown>)}
    WHERE id = ${userId}
    RETURNING *
  `
  const data = rows[0] as PosUser | undefined
  if (!data) return { success: false, error: "Failed to update user" }

  return { success: true, user: data }
}

export async function getSubUsers(parentUserId: string): Promise<PosUser[]> {
  const rows = await sql`
    SELECT * FROM pos_users
    WHERE parent_user_id = ${parentUserId}
    ORDER BY created_at DESC
  `
  return rows as unknown as PosUser[]
}

export async function deleteSubUser(
  parentUserId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const parentUser = await getUserById(parentUserId)
  if (!parentUser || parentUser.role !== "pos_user") {
    return { success: false, error: "Only admin users can delete sub-users" }
  }

  const userToDelete = await getUserById(userId)
  if (!userToDelete || userToDelete.parent_user_id !== parentUserId) {
    return { success: false, error: "User not found or access denied" }
  }

  await sql`DELETE FROM pos_users WHERE id = ${userId}`
  return { success: true }
}

export interface CreatePosUserInput {
  email: string
  password: string
  name?: string
  privileges: UserPrivileges
}

export interface UpdatePosUserInput {
  email?: string
  password?: string
  name?: string
  privileges?: UserPrivileges
  is_active?: boolean
}

export async function getAllPosUsers(): Promise<PosUser[]> {
  const rows = await sql`
    SELECT * FROM pos_users
    WHERE parent_user_id IS NULL
    ORDER BY created_at DESC
  `
  return rows as unknown as PosUser[]
}

export async function createPosUserByAdmin(
  input: CreatePosUserInput
): Promise<{ success: boolean; user?: PosUser; error?: string }> {
  const existingUser = await getUserByEmail(input.email)
  if (existingUser) {
    return { success: false, error: "Email already exists" }
  }

  const passwordHash = await hashPassword(input.password)

  const rows = await sql`
    INSERT INTO pos_users (email, password_hash, role, parent_user_id, name, privileges, is_active)
    VALUES (
      ${input.email.toLowerCase().trim()},
      ${passwordHash},
      'pos_user',
      null,
      ${input.name || null},
      ${JSON.stringify(input.privileges)},
      true
    )
    RETURNING *
  `
  const data = rows[0] as PosUser | undefined
  if (!data) return { success: false, error: "Failed to create POS user" }

  return { success: true, user: data }
}

async function getUserByIdForAdmin(userId: string): Promise<PosUser | null> {
  const rows = await sql`
    SELECT * FROM pos_users WHERE id = ${userId} LIMIT 1
  `
  return (rows[0] as PosUser) ?? null
}

export async function updatePosUserByAdmin(
  userId: string,
  input: UpdatePosUserInput
): Promise<{ success: boolean; user?: PosUser; error?: string }> {
  const userToUpdate = await getUserByIdForAdmin(userId)
  if (!userToUpdate || userToUpdate.parent_user_id !== null) {
    return { success: false, error: "User not found or not a POS user" }
  }

  const values: Record<string, unknown> = {}

  if (input.email !== undefined) {
    const existing = await getUserByEmail(input.email)
    if (existing && existing.id !== userId) {
      return { success: false, error: "Email already exists" }
    }
    values.email = input.email.toLowerCase().trim()
  }
  if (input.password !== undefined) values.password_hash = await hashPassword(input.password)
  if (input.name !== undefined) values.name = input.name || null
  if (input.privileges !== undefined) values.privileges = JSON.stringify(input.privileges)
  if (input.is_active !== undefined) values.is_active = input.is_active

  if (Object.keys(values).length === 0) {
    return { success: true, user: userToUpdate }
  }

  const rows = await sql`
    UPDATE pos_users SET ${sql(values)}
    WHERE id = ${userId}
    RETURNING *
  `
  const data = rows[0] as PosUser | undefined
  if (!data) return { success: false, error: "Failed to update POS user" }

  return { success: true, user: data }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const { getUserSession } = await import("@/lib/auth/session")
  const session = await getUserSession()
  if (!session) return { success: false, error: "Not authenticated" }

  const rows = await sql`
    SELECT password_hash FROM pos_users WHERE id = ${session.id} LIMIT 1
  `
  const data = rows[0] as { password_hash: string } | undefined
  if (!data) return { success: false, error: "User not found" }

  const isValid = await verifyPassword(currentPassword, data.password_hash)
  if (!isValid) return { success: false, error: "Current password is incorrect" }

  const newHash = await hashPassword(newPassword)
  await sql`UPDATE pos_users SET password_hash = ${newHash} WHERE id = ${session.id}`

  return { success: true }
}

export async function deletePosUserByAdmin(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const userToDelete = await getUserByIdForAdmin(userId)
  if (!userToDelete || userToDelete.parent_user_id !== null) {
    return { success: false, error: "User not found or not a POS user" }
  }

  const subUsers = await getSubUsers(userId)
  if (subUsers.length > 0) {
    return { success: false, error: "Cannot delete POS user with existing sub-users. Please delete sub-users first." }
  }

  await sql`DELETE FROM pos_users WHERE id = ${userId}`
  return { success: true }
}
