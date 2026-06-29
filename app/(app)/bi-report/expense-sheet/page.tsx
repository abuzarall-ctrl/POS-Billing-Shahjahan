import { requirePrivilege } from "@/lib/auth/privileges"
import { ExpenseSheetClient } from "./expense-sheet-client"

export default async function ExpenseSheetPage() {
  await requirePrivilege("bi-report")
  return <ExpenseSheetClient />
}
