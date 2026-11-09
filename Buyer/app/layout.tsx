import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "TradeLock | Trade with confidence",
  description: "Wallet-powered trade escrow and invoice integrity.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
