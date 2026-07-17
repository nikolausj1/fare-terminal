import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SQLite DB file is a build artifact (populated by `npm run build`'s
  // seed+pipeline guard — see scripts/build.mjs) rather than an npm
  // dependency, so Next's default output-file tracing (which only follows
  // import/require/fs usage) won't automatically know every API route
  // needs it bundled into the Vercel serverless function. Explicitly
  // include it for every route under /api/**, where lib/markets/queries.ts
  // and the derivation jobs open the DB via db/index.ts (DATABASE_PATH,
  // default ./data/fare-terminal.db).
  outputFileTracingIncludes: {
    "/api/*": ["./data/fare-terminal.db"],
    "/api/**": ["./data/fare-terminal.db"],
  },
};

export default nextConfig;
