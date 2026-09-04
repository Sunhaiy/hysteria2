import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { SiteProvider } from "@/components/site-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.scss";

// Apply the stored theme before paint to avoid a flash of the wrong theme.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Hysteria 2 Control Plane",
  description: "Operator-first membership and traffic management console for Hysteria 2 and VLESS + REALITY.",
  icons: {
    icon: [{ url: "/brand-icon.svg", type: "image/svg+xml" }],
    shortcut: "/brand-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
