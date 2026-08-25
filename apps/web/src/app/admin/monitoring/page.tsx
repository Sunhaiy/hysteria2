import { redirect } from "next/navigation";

export default function LegacyMonitoringPage() {
  redirect("/admin/operations?tab=alerts");
}
