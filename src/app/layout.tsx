import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "po-chain",
  description: "Inventory + chain suggester + patch library for Pocket Operators, EP devices, Volcas and microKorg.",
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
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-6">
          <Link href="/" className="font-mono text-lg tracking-tight text-amber-400">
            po-chain
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-100">inventory</Link>
            <Link href="/chain" className="hover:text-zinc-100">chain</Link>
            <Link href="/patches" className="hover:text-zinc-100">patches</Link>
            <Link href="/ep-tool" className="hover:text-zinc-100">ep-tool</Link>
            <Link href="/microkorg-tool" className="hover:text-zinc-100">µKorg</Link>
          </nav>
          <span className="ml-auto text-xs text-zinc-500 font-mono">v0.1</span>
        </header>
        <main className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">{children}</main>
        <footer className="border-t border-zinc-800 px-6 py-3 text-xs text-zinc-500">
          local-only · localStorage · no accounts
        </footer>
      </body>
    </html>
  );
}
