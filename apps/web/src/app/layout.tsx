import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { SiteProvider } from "@/components/site-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { NavigationProgress } from "@/components/navigation-progress";
import {
  getPublicSiteInfo,
  jsonLd,
  publicSiteDescription,
  publicSiteUrl,
} from "@/lib/seo";
import "./globals.scss";
import "./seo.scss";

// Apply the stored theme before paint to avoid a flash of the wrong theme.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteInfo();
  const description = publicSiteDescription(site);
  return {
    metadataBase: new URL(publicSiteUrl()),
    title: {
      default: site.browserTitle || site.name,
      template: `%s | ${site.name}`,
    },
    description,
    icons: {
      icon: [{ url: site.iconUrl || "/brand-icon.svg" }],
      shortcut: site.iconUrl || "/brand-icon.svg",
    },
    openGraph: {
      type: "website",
      siteName: site.name,
      title: site.browserTitle || site.name,
      description,
      url: "/",
    },
    twitter: {
      card: "summary_large_image",
      title: site.browserTitle || site.name,
      description,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const site = await getPublicSiteInfo();
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: publicSiteUrl(),
    logo: new URL(
      site.iconUrl || "/brand-icon.svg",
      publicSiteUrl(),
    ).toString(),
  };
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: publicSiteUrl(),
    inLanguage: "zh-CN",
  };

  return (
    <html
      lang="zh-CN"
      data-theme="light"
      data-accent="green"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(organization) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(website) }}
        />
        <ThemeProvider>
          <NavigationProgress />
          <SiteProvider>
            <AuthProvider>{children}</AuthProvider>
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
