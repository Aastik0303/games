import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { AppHeader } from "@/components/layout/app-header";
import { NetworkBanner } from "@/components/layout/network-banner";
import { PrismBackground } from "@/components/layout/prism-background";
import { SETTINGS_BOOTSTRAP_SCRIPT } from "@/lib/settings";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Prism — play puzzles together", template: "%s · Prism" },
  description: "Solve puzzles solo or with compatible players, create private rooms, and watch together.",
};

export const viewport: Viewport = {
  themeColor: "#080a12",
  colorScheme: "dark",
};

function HeaderFallback() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <div className="glass ml-auto h-13 w-28 rounded-2xl" />
      </div>
    </header>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies saved motion/text/contrast prefs before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-[70] rounded-lg bg-ink-700 px-4 py-2 text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <AppProviders>
          <PrismBackground />
          <Suspense fallback={<HeaderFallback />}>
            <AppHeader />
          </Suspense>
          <NetworkBanner />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <footer className="border-t border-line bg-ink-950/30 py-6 backdrop-blur-md text-center text-xs text-fg-subtle">
            <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-5 gap-y-2 px-4">
              <Link href="/guidelines" className="hover:text-fg">Community guidelines</Link>
              <Link href="/privacy" className="hover:text-fg">Privacy</Link>
              <span>Prism · Built for play, not for profiling.</span>
            </nav>
          </footer>
        </AppProviders>
      </body>
    </html>
  );
}
