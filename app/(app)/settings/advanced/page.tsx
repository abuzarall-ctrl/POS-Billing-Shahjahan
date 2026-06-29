import { redirect } from "next/navigation"

// SET-H5 / SET-C7: the legacy "Advanced" all-in-one page persisted some values to
// localStorage (per-browser, not per-account) and duplicated the new per-concern pages.
// Deleted in favour of the focused /settings/{store,invoice,tax,pos,hardware} pages.
// Redirect any stale bookmarks to the canonical Store entry.
export default function AdvancedSettingsPage() {
  redirect("/settings/store")
}
