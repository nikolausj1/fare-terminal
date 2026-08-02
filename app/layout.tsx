import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { DemoBanner } from "@/components/ui/DemoBanner";
import { NavBar } from "@/components/layout/NavBar";
import { Footer } from "@/components/layout/Footer";
import { getDataSourceMode } from "@/lib/markets/queries";

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

const homeTitle = "Fare Terminal · Airfare market intelligence";
const homeDescription =
  "Market-level airfare intelligence built from observed data: benchmark prices, history, events, and recommendations for airport-pair routes.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    template: "%s · Fare Terminal",
    default: homeTitle,
  },
  description: homeDescription,
  applicationName: "Fare Terminal",
  // WP-F5: the Fare Terminal Index share card (app/api/og/index/route.tsx)
  // — index value + 90d sparkline. Per-market pages override this with
  // their own card via app/market/[origin]/[destination]/page.tsx's
  // generateMetadata (Next resolves the more specific page's openGraph
  // over this root layout default).
  openGraph: {
    title: homeTitle,
    description: homeDescription,
    url: "/",
    images: [{ url: "/api/og/index", width: 1200, height: 630, alt: "Fare Terminal Index" }],
  },
  twitter: {
    card: "summary_large_image",
    title: homeTitle,
    description: homeDescription,
    images: ["/api/og/index"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // DB-derived, not env-derived — see lib/markets/queries.ts#getDataSourceMode
  // and components/ui/DemoBanner.tsx. Memoized per request via React's
  // cache(), so any page below that also calls getMarketSummary/getMarketPulse
  // (which each call getDataSourceMode() internally) reuses this same query
  // result rather than re-running the SELECT DISTINCT.
  const dataSourceMode = getDataSourceMode();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text-primary)]">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <DemoBanner mode={dataSourceMode} />
        <NavBar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer mode={dataSourceMode} />
      </body>
    </html>
  );
}
