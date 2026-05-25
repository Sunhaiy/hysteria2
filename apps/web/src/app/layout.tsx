import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.scss";

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
  description: "Dense, operator-first membership and traffic management console for Hysteria 2.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-theme="dark"
      data-accent="green"
      className={`${inter.variable} ${robotoMono.variable}`}
    >
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
