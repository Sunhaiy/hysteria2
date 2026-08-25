import { redirect } from "next/navigation";

export default function LegacySessionsPage() {
  redirect("/admin/operations?tab=presence");
}
