import { redirect } from "next/navigation"

// SET-L5: legacy /pos/settings URL — point at the focused POS Preferences page now that
// it exists. The Advanced page is still reachable through the sidebar nav for users who
// want the all-in-one view.
export default function PosSettingsPage() {
  redirect("/settings/pos")
}
