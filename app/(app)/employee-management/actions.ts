"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"
import type {
  Employee,
  EmployeeWithUser,
  EmployeeSalary,
  EmployeeSalaryWithEmployee,
  PayrollRun,
  PayrollLine,
  PayrollRunWithLines,
  EmployeeLedgerEntry,
  EmployeeLedgerSummary,
  CreateEmployeeInput,
  UpdateEmployeeInput,
  CreateEmployeeSalaryInput,
  UpdateEmployeeSalaryInput,
  CreatePayrollRunInput,
  ProcessPayrollInput,
  PayrollSummary,
  EmployeesReport,
} from "@/lib/types/employee"

// ============================================
// HELPER: Get available users for linking
// ============================================

export async function getAvailableUsers(excludeEmployeeId?: string): Promise<{ error: string | null; data: Array<{ id: string; email: string; name: string | null }> | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    // Get all active users (owner + sub-users in the same org)
    const allUsers = await sql`
      SELECT id, email, name
      FROM pos_users
      WHERE is_active = true
      AND (id = ${userId} OR parent_user_id = ${userId})
      ORDER BY email
    `

    if (excludeEmployeeId) {
      // Get the current employee's linked user_id
      const currentEmpRows = await sql`
        SELECT user_id FROM employees
        WHERE id = ${excludeEmployeeId}
        AND user_id = ${userId}
        LIMIT 1
      `
      const currentUserId = currentEmpRows[0]?.user_id ?? null

      // Get users already linked to OTHER employees
      const linkedRows = await sql`
        SELECT user_id FROM employees
        WHERE user_id IS NOT NULL
        AND user_id = ${userId}
        AND id != ${excludeEmployeeId}
      `
      const linkedUserIds = new Set(linkedRows.map((e) => e.user_id).filter(Boolean))

      const availableUsers = allUsers.filter((u) => !linkedUserIds.has(u.id) || u.id === currentUserId)
      return { error: null, data: availableUsers as Array<{ id: string; email: string; name: string | null }> }
    }

    // For new employees, exclude all already-linked users
    const linkedRows = await sql`
      SELECT user_id FROM employees
      WHERE user_id IS NOT NULL
      AND user_id = ${userId}
    `
    const linkedUserIds = new Set(linkedRows.map((e) => e.user_id).filter(Boolean))
    const availableUsers = allUsers.filter((u) => !linkedUserIds.has(u.id))

    return { error: null, data: availableUsers as Array<{ id: string; email: string; name: string | null }> }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch users", data: null }
  }
}

// ============================================
// EMPLOYEE CRUD
// ============================================

export async function getEmployees(): Promise<{ error: string | null; data: EmployeeWithUser[] | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const rows = await sql`
      SELECT
        e.*,
        pu.id   AS pu_id,
        pu.email AS pu_email,
        pu.name  AS pu_name
      FROM employees e
      LEFT JOIN pos_users pu ON pu.id = e.user_id
      WHERE e.user_id = ${userId}
      ORDER BY e.created_at DESC
    `

    const data: EmployeeWithUser[] = rows.map((row) => ({
      ...(row as any),
      user: row.pu_id ? { id: row.pu_id, email: row.pu_email, name: row.pu_name } : undefined,
    }))

    return { error: null, data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch employees", data: null }
  }
}

export async function getEmployeeById(id: string): Promise<{ error: string | null; data: EmployeeWithUser | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const rows = await sql`
      SELECT
        e.*,
        pu.id    AS pu_id,
        pu.email AS pu_email,
        pu.name  AS pu_name
      FROM employees e
      LEFT JOIN pos_users pu ON pu.id = e.user_id
      WHERE e.id = ${id}
      AND e.user_id = ${userId}
      LIMIT 1
    `

    if (!rows[0]) return { error: "Employee not found", data: null }

    const row = rows[0] as any
    const data: EmployeeWithUser = {
      ...row,
      user: row.pu_id ? { id: row.pu_id, email: row.pu_email, name: row.pu_name } : undefined,
    }

    return { error: null, data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch employee", data: null }
  }
}

export async function createEmployee(payload: CreateEmployeeInput): Promise<{ error: string | null; data: Employee | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  if (!payload.name || !payload.phone) {
    return { error: "Name and phone are required", data: null }
  }

  try {
    const [row] = await sql`
      INSERT INTO employees (
        user_id, name, phone, email, designation,
        join_date, status, bank_details
      )
      VALUES (
        ${userId},
        ${payload.name.trim()},
        ${payload.phone.trim()},
        ${payload.email?.trim() || null},
        ${payload.designation?.trim() || null},
        ${payload.join_date || new Date().toISOString().split("T")[0]},
        ${payload.status || "active"},
        ${payload.bank_details ? JSON.stringify(payload.bank_details) : null}
      )
      RETURNING *
    `

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/employees")
    return { error: null, data: row as Employee }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create employee", data: null }
  }
}

export async function updateEmployee(id: string, payload: UpdateEmployeeInput): Promise<{ error: string | null; data: Employee | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  if (!id) {
    return { error: "Employee ID is required", data: null }
  }

  const updateData: Record<string, any> = {}
  if (payload.user_id !== undefined) updateData.user_id = payload.user_id || null
  if (payload.name !== undefined) updateData.name = payload.name.trim()
  if (payload.phone !== undefined) updateData.phone = payload.phone.trim()
  if (payload.email !== undefined) updateData.email = payload.email?.trim() || null
  if (payload.designation !== undefined) updateData.designation = payload.designation?.trim() || null
  if (payload.join_date !== undefined) updateData.join_date = payload.join_date
  if (payload.status !== undefined) updateData.status = payload.status
  if (payload.bank_details !== undefined) updateData.bank_details = payload.bank_details ? JSON.stringify(payload.bank_details) : null

  try {
    const [row] = await sql`
      UPDATE employees
      SET ${sql(updateData)}, updated_at = NOW()
      WHERE id = ${id}
      AND user_id = ${userId}
      RETURNING *
    `

    if (!row) return { error: "Employee not found", data: null }

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/employees")
    return { error: null, data: row as Employee }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update employee", data: null }
  }
}

export async function deleteEmployee(employeeId: string): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  if (!employeeId) {
    return { error: "Employee ID is required" }
  }

  try {
    // Verify employee belongs to user
    const empRows = await sql`
      SELECT id FROM employees
      WHERE id = ${employeeId} AND user_id = ${userId}
      LIMIT 1
    `
    if (!empRows[0]) return { error: "Employee not found" }

    // Check for payroll lines
    const payrollLines = await sql`
      SELECT id FROM payroll_lines
      WHERE employee_id = ${employeeId} AND user_id = ${userId}
      LIMIT 1
    `
    if (payrollLines.length > 0) {
      return { error: "Cannot delete employee with payroll records. Set status to 'terminated' instead." }
    }

    // Check for ledger entries
    const ledgerEntries = await sql`
      SELECT id FROM employee_ledger_entries
      WHERE employee_id = ${employeeId} AND user_id = ${userId}
      LIMIT 1
    `
    if (ledgerEntries.length > 0) {
      return { error: "Cannot delete employee with ledger entries. Set status to 'terminated' instead." }
    }

    await sql`DELETE FROM employees WHERE id = ${employeeId} AND user_id = ${userId}`

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/employees")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete employee" }
  }
}

// ============================================
// SALARY MANAGEMENT
// ============================================

export async function getSalaryByEmployee(employeeId: string): Promise<{ error: string | null; data: EmployeeSalary | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    // Verify employee belongs to user
    const empRows = await sql`
      SELECT id FROM employees WHERE id = ${employeeId} AND user_id = ${userId} LIMIT 1
    `
    if (!empRows[0]) return { error: "Employee not found", data: null }

    const today = new Date().toISOString().split("T")[0]
    const rows = await sql`
      SELECT * FROM employee_salaries
      WHERE employee_id = ${employeeId}
      AND user_id = ${userId}
      AND effective_from <= ${today}
      ORDER BY effective_from DESC
      LIMIT 1
    `

    return { error: null, data: (rows[0] ?? null) as EmployeeSalary | null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch salary", data: null }
  }
}

export async function getAllCurrentSalaries(): Promise<{ error: string | null; data: EmployeeSalaryWithEmployee[] | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const employees = await sql`
      SELECT id, name, designation FROM employees
      WHERE status = 'active' AND user_id = ${userId}
    `

    if (!employees || employees.length === 0) {
      return { error: null, data: [] }
    }

    const today = new Date().toISOString().split("T")[0]
    const salaries: EmployeeSalaryWithEmployee[] = []

    for (const employee of employees) {
      const salaryRows = await sql`
        SELECT * FROM employee_salaries
        WHERE employee_id = ${employee.id}
        AND effective_from <= ${today}
        ORDER BY effective_from DESC
        LIMIT 1
      `
      const salary = salaryRows[0]
      if (salary) {
        salaries.push({
          ...(salary as EmployeeSalary),
          employee: {
            id: employee.id as string,
            name: employee.name as string,
            designation: employee.designation as string | null,
          },
        })
      }
    }

    return { error: null, data: salaries }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch salaries", data: null }
  }
}

export async function createOrUpdateEmployeeSalary(payload: CreateEmployeeSalaryInput): Promise<{ error: string | null; data: EmployeeSalary | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  if (!payload.employee_id || !payload.effective_from || payload.basic_salary === undefined) {
    return { error: "Employee ID, effective date, and basic salary are required", data: null }
  }

  try {
    // Verify employee belongs to user
    const empRows = await sql`
      SELECT id FROM employees WHERE id = ${payload.employee_id} AND user_id = ${userId} LIMIT 1
    `
    if (!empRows[0]) return { error: "Employee not found", data: null }

    const [row] = await sql`
      INSERT INTO employee_salaries (employee_id, effective_from, basic_salary, allowances, deductions, user_id)
      VALUES (
        ${payload.employee_id},
        ${payload.effective_from},
        ${payload.basic_salary},
        ${JSON.stringify(payload.allowances || [])}::jsonb,
        ${JSON.stringify(payload.deductions || [])}::jsonb,
        ${userId}
      )
      RETURNING *
    `

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/salary")
    return { error: null, data: row as EmployeeSalary }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create salary record", data: null }
  }
}

// ============================================
// PAYROLL MANAGEMENT
// ============================================

export async function createPayrollRun(payload: CreatePayrollRunInput): Promise<{ error: string | null; data: PayrollRun | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  if (!payload.month) {
    return { error: "Month is required", data: null }
  }

  try {
    // Check if payroll run already exists for this month
    const existing = await sql`
      SELECT id FROM payroll_runs
      WHERE month = ${payload.month} AND user_id = ${userId}
      LIMIT 1
    `
    if (existing[0]) {
      return { error: "Payroll run already exists for this month", data: null }
    }

    const [row] = await sql`
      INSERT INTO payroll_runs (month, status, user_id)
      VALUES (${payload.month}, 'draft', ${userId})
      RETURNING *
    `

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/payroll")
    return { error: null, data: row as PayrollRun }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create payroll run", data: null }
  }
}

export async function getPayrollRuns(): Promise<{ error: string | null; data: PayrollRun[] | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const rows = await sql`
      SELECT * FROM payroll_runs
      WHERE user_id = ${userId}
      ORDER BY month DESC
    `
    return { error: null, data: rows as PayrollRun[] }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch payroll runs", data: null }
  }
}

export async function getPayrollRunWithLines(payrollId: string): Promise<{ error: string | null; data: PayrollRunWithLines | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const runRows = await sql`
      SELECT * FROM payroll_runs
      WHERE id = ${payrollId} AND user_id = ${userId}
      LIMIT 1
    `
    if (!runRows[0]) return { error: "Payroll run not found", data: null }
    const payrollRun = runRows[0] as PayrollRun

    const lineRows = await sql`
      SELECT
        pl.*,
        e.id          AS emp_id,
        e.name        AS emp_name,
        e.designation AS emp_designation
      FROM payroll_lines pl
      LEFT JOIN employees e ON e.id = pl.employee_id
      WHERE pl.payroll_id = ${payrollId}
      AND pl.user_id = ${userId}
      ORDER BY pl.created_at ASC
    `

    const lines: PayrollLine[] = lineRows.map((row) => ({
      ...(row as any),
      employee: row.emp_id
        ? { id: row.emp_id, name: row.emp_name, designation: row.emp_designation }
        : undefined,
    }))

    const total_gross = lines.reduce((sum, line) => sum + Number(line.gross || 0), 0)
    const total_deductions = lines.reduce((sum, line) => sum + Number(line.deductions || 0), 0)
    const total_net = lines.reduce((sum, line) => sum + Number(line.net || 0), 0)

    return {
      error: null,
      data: {
        ...payrollRun,
        lines,
        total_gross,
        total_deductions,
        total_net,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch payroll run", data: null }
  }
}

export async function processPayrollRun(payload: ProcessPayrollInput): Promise<{ error: string | null; data: PayrollRunWithLines | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const runRows = await sql`
      SELECT * FROM payroll_runs
      WHERE id = ${payload.payroll_id} AND user_id = ${userId}
      LIMIT 1
    `
    if (!runRows[0]) return { error: "Payroll run not found", data: null }
    const payrollRun = runRows[0] as any

    if (payrollRun.status !== "draft") {
      return { error: "Payroll run is already processed", data: null }
    }

    // Get all active employees for current user
    const employees = await sql`
      SELECT id FROM employees
      WHERE status = 'active' AND user_id = ${userId}
    `

    if (!employees || employees.length === 0) {
      return { error: "No active employees found", data: null }
    }

    const today = new Date().toISOString().split("T")[0]
    const payrollLines: any[] = []

    for (const employee of employees) {
      const salaryRows = await sql`
        SELECT * FROM employee_salaries
        WHERE employee_id = ${employee.id}
        AND user_id = ${userId}
        AND effective_from <= ${today}
        ORDER BY effective_from DESC
        LIMIT 1
      `
      const salary = salaryRows[0]

      if (salary) {
        const allowances = (salary.allowances as Array<{ name: string; amount: number }>) || []
        const deductions = (salary.deductions as Array<{ name: string; amount: number }>) || []

        const totalAllowances = allowances.reduce((sum, a) => sum + Number(a.amount || 0), 0)
        const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount || 0), 0)

        const gross = Number(salary.basic_salary) + totalAllowances
        const net = gross - totalDeductions

        payrollLines.push({
          payroll_id: payload.payroll_id,
          employee_id: employee.id,
          gross,
          deductions: totalDeductions,
          net,
          payment_status: "pending",
          user_id: userId,
        })
      }
    }

    if (payrollLines.length === 0) {
      return { error: "No employees with salary configuration found", data: null }
    }

    // Bulk-insert payroll lines
    for (const line of payrollLines) {
      await sql`
        INSERT INTO payroll_lines (payroll_id, employee_id, gross, deductions, net, payment_status, user_id)
        VALUES (${line.payroll_id}, ${line.employee_id}, ${line.gross}, ${line.deductions}, ${line.net}, ${line.payment_status}, ${line.user_id})
      `
    }

    // Update payroll run status
    await sql`
      UPDATE payroll_runs
      SET status = 'processed', processed_at = NOW()
      WHERE id = ${payload.payroll_id} AND user_id = ${userId}
    `

    return getPayrollRunWithLines(payload.payroll_id)
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to process payroll run", data: null }
  }
}

export async function markPayrollLinePaid(lineId: string): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const lineRows = await sql`
      SELECT * FROM payroll_lines
      WHERE id = ${lineId} AND user_id = ${userId}
      LIMIT 1
    `
    if (!lineRows[0]) return { error: "Payroll line not found" }
    const line = lineRows[0] as any

    if (line.payment_status === "paid") {
      return { error: "Payroll line is already marked as paid" }
    }

    // Get payroll run month
    const runRows = await sql`
      SELECT month FROM payroll_runs
      WHERE id = ${line.payroll_id} AND user_id = ${userId}
      LIMIT 1
    `
    const monthStr = runRows[0]?.month
      ? new Date(runRows[0].month as string).toISOString().slice(0, 7)
      : ""

    // Create ledger entry for salary payment
    const [ledgerEntry] = await sql`
      INSERT INTO employee_ledger_entries (
        employee_id, entry_date, description, debit, credit,
        reference_type, reference_id, user_id
      )
      VALUES (
        ${line.employee_id},
        ${new Date().toISOString().split("T")[0]},
        ${"Salary payment for " + monthStr},
        0,
        ${line.net},
        'salary_payment',
        ${lineId},
        ${userId}
      )
      RETURNING *
    `

    // Update payroll line to paid
    await sql`
      UPDATE payroll_lines
      SET payment_status = 'paid', paid_at = NOW(), ledger_entry_id = ${ledgerEntry.id}
      WHERE id = ${lineId}
    `

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/payroll")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to mark payroll line as paid" }
  }
}

export async function markPayrollRunPaid(runId: string): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    // Verify payroll run belongs to user
    const runRows = await sql`
      SELECT id FROM payroll_runs WHERE id = ${runId} AND user_id = ${userId} LIMIT 1
    `
    if (!runRows[0]) return { error: "Payroll run not found" }

    // Get pending lines
    const pendingLines = await sql`
      SELECT id FROM payroll_lines
      WHERE payroll_id = ${runId} AND user_id = ${userId} AND payment_status = 'pending'
    `
    if (!pendingLines || pendingLines.length === 0) {
      return { error: "No pending payroll lines found" }
    }

    // Mark all pending lines as paid
    for (const line of pendingLines) {
      const result = await markPayrollLinePaid(line.id as string)
      if (result.error) return result
    }

    // Update payroll run status
    await sql`
      UPDATE payroll_runs SET status = 'paid' WHERE id = ${runId} AND user_id = ${userId}
    `

    revalidatePath("/employee-management")
    revalidatePath("/employee-management/payroll")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to mark payroll run as paid" }
  }
}

// ============================================
// LEDGER MANAGEMENT
// ============================================

export async function getEmployeeLedgerEntries(employeeId: string): Promise<{ error: string | null; data: EmployeeLedgerEntry[] | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    // Verify employee belongs to user
    const empRows = await sql`
      SELECT id FROM employees WHERE id = ${employeeId} AND user_id = ${userId} LIMIT 1
    `
    if (!empRows[0]) return { error: "Employee not found", data: null }

    const rows = await sql`
      SELECT
        ele.*,
        e.id   AS emp_id,
        e.name AS emp_name
      FROM employee_ledger_entries ele
      LEFT JOIN employees e ON e.id = ele.employee_id
      WHERE ele.employee_id = ${employeeId}
      AND ele.user_id = ${userId}
      ORDER BY ele.entry_date DESC, ele.created_at DESC
    `

    const data: EmployeeLedgerEntry[] = rows.map((row) => ({
      ...(row as any),
      employee: row.emp_id ? { id: row.emp_id, name: row.emp_name } : undefined,
    }))

    return { error: null, data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch ledger entries", data: null }
  }
}

export async function getEmployeeBalance(employeeId: string): Promise<{ error: string | null; data: number }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    // Verify employee belongs to user
    const empRows = await sql`
      SELECT id FROM employees WHERE id = ${employeeId} AND user_id = ${userId} LIMIT 1
    `
    if (!empRows[0]) return { error: "Employee not found", data: 0 }

    const [result] = await sql`
      SELECT
        COALESCE(SUM(debit), 0)  AS total_debit,
        COALESCE(SUM(credit), 0) AS total_credit
      FROM employee_ledger_entries
      WHERE employee_id = ${employeeId} AND user_id = ${userId}
    `

    const balance = Number(result.total_credit) - Number(result.total_debit)
    return { error: null, data: balance }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch employee balance", data: 0 }
  }
}

// ============================================
// REPORTS
// ============================================

export async function getPayrollSummary(month?: string): Promise<{ error: string | null; data: PayrollSummary[] | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const runs = await sql`
      SELECT * FROM payroll_runs
      WHERE user_id = ${userId}
      ${month ? sql`AND month = ${month}` : sql``}
      ORDER BY month DESC
    `

    const summaries: PayrollSummary[] = []

    for (const run of runs) {
      const lines = await sql`
        SELECT gross, deductions, net, payment_status FROM payroll_lines
        WHERE payroll_id = ${run.id} AND user_id = ${userId}
      `

      const total_employees = lines.length
      const total_gross = lines.reduce((sum, l) => sum + Number(l.gross || 0), 0)
      const total_deductions = lines.reduce((sum, l) => sum + Number(l.deductions || 0), 0)
      const total_net = lines.reduce((sum, l) => sum + Number(l.net || 0), 0)
      const paid_count = lines.filter((l) => l.payment_status === "paid").length
      const pending_count = total_employees - paid_count

      summaries.push({
        month: run.month as string,
        total_employees,
        total_gross,
        total_deductions,
        total_net,
        paid_count,
        pending_count,
      })
    }

    return { error: null, data: summaries }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch payroll summary", data: null }
  }
}

export async function getEmployeesReport(): Promise<{ error: string | null; data: EmployeesReport | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const employees = await sql`
      SELECT
        e.id, e.name, e.designation, e.join_date, e.status,
        pu.email AS user_email
      FROM employees e
      LEFT JOIN pos_users pu ON pu.id = e.user_id
      WHERE e.user_id = ${userId}
      ORDER BY e.created_at DESC
    `

    const today = new Date().toISOString().split("T")[0]
    const reportEmployees: EmployeesReport["employees"] = []
    let total_monthly_cost = 0

    for (const emp of employees) {
      const salaryRows = await sql`
        SELECT * FROM employee_salaries
        WHERE employee_id = ${emp.id}
        AND user_id = ${userId}
        AND effective_from <= ${today}
        ORDER BY effective_from DESC
        LIMIT 1
      `
      const salary = salaryRows[0]

      let current_salary: number | null = null
      if (salary) {
        const allowances = (salary.allowances as Array<{ name: string; amount: number }>) || []
        const deductions = (salary.deductions as Array<{ name: string; amount: number }>) || []
        const totalAllowances = allowances.reduce((sum, a) => sum + Number(a.amount || 0), 0)
        const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount || 0), 0)
        current_salary = Number(salary.basic_salary) + totalAllowances - totalDeductions
        if (emp.status === "active") {
          total_monthly_cost += current_salary
        }
      }

      reportEmployees.push({
        id: emp.id as string,
        name: emp.name as string,
        designation: emp.designation as string | null,
        join_date: emp.join_date as string,
        status: emp.status as any,
        current_salary,
        user_email: (emp.user_email as string | null) || null,
      })
    }

    const active_employees = reportEmployees.filter((e) => e.status === "active").length

    return {
      error: null,
      data: {
        employees: reportEmployees,
        total_employees: employees.length,
        active_employees,
        total_monthly_cost,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch employees report", data: null }
  }
}
