"use client"

import { useState, useMemo, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Pencil, FileText, Search, Upload, Download, FileSpreadsheet, ChevronDown } from "lucide-react"
import { DeletePartyButton } from "@/components/delete-party-button"
import PartyDialog from "./party-dialog"
import { CurrencyDisplay } from "@/components/currency-display"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { bulkImportParties } from "./actions"
import { toast } from "sonner"

interface Party {
  id: string
  name: string
  phone: string
  address?: string | null
  type: string
  created_at?: string
}

interface PartiesPageClientProps {
  parties: Party[]
  balances: Record<string, number>
}

export function PartiesPageClient({ parties, balances }: PartiesPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const [typeFilter, setTypeFilter] = useState<"all" | "Customer" | "Vendor">(
    (searchParams.get("type") as "all" | "Customer" | "Vendor") || "all"
  )
  const [balanceFilter, setBalanceFilter] = useState<"all" | "receivable" | "payable">("all")
  const [showImportExport, setShowImportExport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filter parties
  const filteredParties = useMemo(() => {
    let filtered = parties

    if (typeFilter !== "all") {
      filtered = filtered.filter((p) => p.type === typeFilter)
    }

    if (balanceFilter === "receivable") {
      filtered = filtered.filter((p) => (balances[p.id] ?? 0) > 0)
    } else if (balanceFilter === "payable") {
      filtered = filtered.filter((p) => (balances[p.id] ?? 0) < 0)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(query) || p.phone.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [parties, typeFilter, balanceFilter, searchQuery, balances])

  const handleTypeChange = (value: string) => {
    const newType = value as "all" | "Customer" | "Vendor"
    setTypeFilter(newType)
    const params = new URLSearchParams(searchParams.toString())
    if (newType === "all") {
      params.delete("type")
    } else {
      params.set("type", newType)
    }
    router.push(`/parties?${params.toString()}`)
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    const params = new URLSearchParams(searchParams.toString())
    if (value.trim()) {
      params.set("search", value)
    } else {
      params.delete("search")
    }
    router.push(`/parties?${params.toString()}`)
  }

  const handleExport = () => {
    const headers = ["name", "type", "phone", "address"]
    const rows = parties.map((p) => [
      `"${(p.name ?? "").replace(/"/g, '""')}"`,
      p.type ?? "Customer",
      `"${(p.phone ?? "").replace(/"/g, '""')}"`,
      `"${(p.address ?? "").replace(/"/g, '""')}"`,
    ].join(","))
    const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `parties-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setShowImportExport(false)
  }

  const handleDownloadTemplate = () => {
    const csv = "﻿name,type,phone,address\nAhmed Store,Customer,03001234567,Lahore\nSupplier Co,Vendor,03211234567,Karachi"
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "parties-import-template.csv"
    a.click()
    URL.revokeObjectURL(url)
    setShowImportExport(false)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text.replace(/^﻿/, "").split("\n").filter((l) => l.trim())
    if (lines.length < 2) { toast.error("CSV is empty"); return }

    const firstLine = lines[0].toLowerCase()
    const headerCols = firstLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    const hasName = headerCols.includes("name")
    const hasPartyCol = ["type", "phone", "address"].some((c) => headerCols.includes(c))
    if (!hasName || !hasPartyCol) {
      toast.error("Wrong file format. Please use the parties import template.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    const dataLines = lines.slice(1)

    const rows = dataLines.map((line) => {
      const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim())
      return {
        name: cols[0] ?? "",
        type: cols[1] ?? "Customer",
        phone: cols[2] ?? "",
        address: cols[3] ?? "",
      }
    }).filter((r) => r.name)

    if (!rows.length) { toast.error("No valid rows found"); return }

    toast.loading(`Importing ${rows.length} parties...`, { id: "bulk-import-parties" })
    const result = await bulkImportParties(rows)
    toast.dismiss("bulk-import-parties")

    if (result.errors.length > 0) {
      toast.warning(`Imported ${result.imported}. Error: ${result.errors[0]}`)
    } else {
      toast.success(`Imported ${result.imported} parties successfully!`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
    setShowImportExport(false)
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <CardTitle className="text-base sm:text-lg">All parties</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-8 w-full sm:w-56"
              />
            </div>
            {/* Type Filter */}
            <Tabs value={typeFilter} onValueChange={handleTypeChange}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="Customer">Customers</TabsTrigger>
                <TabsTrigger value="Vendor">Vendors</TabsTrigger>
              </TabsList>
            </Tabs>
            {/* Balance Filter */}
            <div className="flex items-center gap-1">
              {(["all", "receivable", "payable"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setBalanceFilter(f)}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                    balanceFilter === f
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {f === "all" ? "All Balance" : f === "receivable" ? "Receivable" : "Payable"}
                </button>
              ))}
            </div>
            {/* Import/Export dropdown */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setShowImportExport((v) => !v)}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Import/Export
                <ChevronDown className="w-3 h-3" />
              </Button>
              {showImportExport && (
                <div className="absolute right-0 top-9 z-20 w-44 rounded-lg border border-border bg-popover shadow-lg">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 rounded-t-lg"
                    onClick={handleDownloadTemplate}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Template
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50"
                    onClick={() => { fileInputRef.current?.click(); setShowImportExport(false) }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import CSV
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 rounded-b-lg"
                    onClick={handleExport}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1.5 px-2 sm:px-3 text-xs w-[20%]">Name</th>
                <th className="py-1.5 px-2 sm:px-3 text-xs hidden sm:table-cell w-[15%]">Phone</th>
                <th className="py-1.5 px-2 sm:px-3 text-xs hidden md:table-cell w-[20%]">Address</th>
                <th className="py-1.5 px-2 sm:px-3 text-xs w-[12%]">Type</th>
                <th className="py-1.5 px-2 sm:px-3 text-xs w-[18%]">Balance</th>
                <th className="py-1.5 px-2 sm:px-3 text-xs w-[15%]">Actions</th>
              </tr>
            </thead>
            <tbody className="[&>tr:not(:last-child)]:border-b">
              {filteredParties.map((party) => {
                const balance = balances[party.id] || 0
                const isCustomer = party.type === "Customer"
                return (
                  <tr key={party.id} className="hover:bg-muted/50">
                    <td className="py-1.5 px-2 sm:px-3 font-medium text-foreground text-xs w-[20%]">
                      <div className="flex flex-col min-w-0 overflow-hidden">
                        <span className="truncate break-words">{party.name}</span>
                        <span className="text-[10px] text-muted-foreground sm:hidden truncate break-all">
                          {party.phone}
                        </span>
                        {party.address && (
                          <span className="text-[10px] text-muted-foreground md:hidden truncate">
                            {party.address}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 sm:px-3 text-foreground text-xs hidden sm:table-cell w-[15%]">
                      <span className="truncate block break-all">{party.phone}</span>
                    </td>
                    <td className="py-1.5 px-2 sm:px-3 text-muted-foreground text-xs hidden md:table-cell w-[20%]">
                      <span className="truncate block">{party.address || "—"}</span>
                    </td>
                    <td className="py-1.5 px-2 sm:px-3 w-[15%]">
                      <Badge
                        variant={party.type === "Customer" ? "default" : "secondary"}
                        className="text-[10px] whitespace-nowrap px-1.5 py-0"
                      >
                        {party.type}
                      </Badge>
                    </td>
                    <td className="py-1.5 px-2 sm:px-3 w-[20%]">
                      <span
                        className={`text-xs font-medium ${
                          isCustomer
                            ? balance > 0
                              ? "text-amber-600"
                              : balance < 0
                                ? "text-red-600"
                                : "text-muted-foreground"
                            : balance > 0
                              ? "text-red-600"
                              : balance < 0
                                ? "text-emerald-600"
                                : "text-muted-foreground"
                        }`}
                      >
                        {isCustomer ? (
                          <CurrencyDisplay amount={balance} />
                        ) : (
                          <span>
                            {balance !== 0 ? <CurrencyDisplay amount={balance} /> : "—"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 sm:px-3 w-[20%]">
                      <div className="flex items-center gap-1">
                        <Link href={`/parties/${party.id}/ledger`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View Ledger">
                            <FileText className="w-3 h-3" />
                          </Button>
                        </Link>
                        <PartyDialog
                          party={party}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit">
                              <Pencil className="w-3 h-3" />
                            </Button>
                          }
                        />
                        <DeletePartyButton partyId={party.id} partyName={party.name} />
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredParties.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground text-xs px-4">
                    {searchQuery || typeFilter !== "all"
                      ? "No parties found matching your filters."
                      : "No parties found. Add your first customer or vendor."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
