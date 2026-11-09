import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingRoot: process.cwd(),
  // The website uses gateways, never validator databases, binaries, or private keys.
  outputFileTracingExcludes: { "*": ["**/node/**", "**/.runtime/**", "**/.git/**", "**/Buyer/**", "**/Supplier/**", "**/installers/**"] },
  outputFileTracingIncludes: { "/api/*": ["./lib/network-connection.json"] },
  // Keep local builds from spawning several memory-heavy worker processes.
  experimental: { cpus: 1 },
  // npm run build checks generated route types first, before bundling consumes memory.
  typescript: { ignoreBuildErrors: true },
};
export default config;
