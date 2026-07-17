import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { DemoBanner } from "@/components/ui/DemoBanner";
import { NavBar } from "@/components/layout/NavBar";
import { Footer } from "@/components/layout/Footer";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3111";
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    template: "%s · Fare Terminal",
    default: "Fare Terminal · Airfare market intelligence",
  },
  description:
    "Market-level airfare intelligence built from observed data: benchmark prices, history, events, and recommendations for airport-pair routes.",
  applicationName: "Fare Terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text-primary)]">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <DemoBanner />
        <NavBar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
