import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { SiteProvider } from "@/components/site-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.scss";

// Apply the stored theme before paint to avoid a flash of the wrong theme.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

const inter = Inter({
  variable: "--font-body-face",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hysteria 2 Control Plane",
  description: "Operator-first membership and traffic management console for Hysteria 2 and VLESS + REALITY.",
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
      className={`${inter.variable} ${robotoMono.variable}`}
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
