"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { changePassword } from "@/app/(app)/settings/actions"
import { toast } from "sonner"

export function SecurityForm() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, startTransition] = useTransition()

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("All fields are required")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match")
      return
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters")
      return
    }

    // SET-C3: was previously calling supabase.auth.updateUser, which doesn't exist for this
    // custom-auth app. Now calls the server action that verifies the current password
    // against the bcrypt hash in pos_users and writes the new hash back.
    startTransition(async () => {
      const result = await changePassword({ currentPassword, newPassword })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Password updated successfully")
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Change your account password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-sm">
        <div className="space-y-2">
          <Label htmlFor="currentPwd">Current Password</Label>
          <Input
            id="currentPwd"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPwd">New Password</Label>
          <Input
            id="newPwd"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPwd">Confirm New Password</Label>
          <Input
            id="confirmPwd"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <Button onClick={handleChangePassword} disabled={pending}>
          {pending ? "Updating..." : "Update Password"}
        </Button>
      </CardContent>
    </Card>
  )
}
