import type { Metadata } from "next";
import { HomepageExperience } from "@/components/homepage-experience";
import { getPublicCatalog } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const catalog = await getPublicCatalog();
  return <HomepageExperience initialCatalog={catalog} />;
}
