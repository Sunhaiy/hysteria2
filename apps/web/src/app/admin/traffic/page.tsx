import { redirect } from "next/navigation";

export default function LegacyTrafficPage() {
  redirect("/admin/operations?tab=traffic");
}
