"use server"

import sql from "@/lib/db"
import { Admin } from "@/lib/types/admin"
import bcrypt from "bcryptjs"

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function authenticateAdmin(email: string, password: string): Promise<Admin | null> {
  const rows = await sql`
    SELECT * FROM admins
    WHERE email = ${email.toLowerCase().trim()} AND is_active = true
    LIMIT 1
  `
  const data = rows[0] as Admin | undefined
  if (!data) return null

  const isValid = await verifyPassword(password, data.password_hash)
  if (!isValid) return null

  return data
}

export async function getAdminById(adminId: string): Promise<Admin | null> {
  const rows = await sql`
    SELECT * FROM admins
    WHERE id = ${adminId} AND is_active = true
    LIMIT 1
  `
  return (rows[0] as Admin) ?? null
}

export async function getAdminByEmail(email: string): Promise<Admin | null> {
  const rows = await sql`
    SELECT * FROM admins
    WHERE email = ${email.toLowerCase().trim()}
    LIMIT 1
  `
  return (rows[0] as Admin) ?? null
}
