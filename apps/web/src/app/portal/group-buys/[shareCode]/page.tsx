import { GroupBuyExperience } from "@/components/group-buy-experience";

export default async function SharedGroupBuyPage({
  params,
}: {
  params: Promise<{ shareCode: string }>;
}) {
  const { shareCode } = await params;
  return <GroupBuyExperience shareCode={shareCode} />;
}
