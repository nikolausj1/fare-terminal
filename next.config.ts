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
  // Keys are route globs; '/**' covers server-rendered pages (home, market
  // pages) as well as API routes — all of them read the DB at request time.
  // The glob ships whichever DB artifact the deployment uses: the demo
  // build creates data/fare-terminal.db, a real-data deployment checks in
  // data/real.db and points DATABASE_PATH at it (see docs/RUNBOOK.md).
  outputFileTracingIncludes: {
    "/**": ["./data/*.db"],
    "/api/**": ["./data/*.db"],
  },
};

export default nextConfig;
