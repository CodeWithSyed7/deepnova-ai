/**
 * Vercel's functions run on Node, and these files read only `process.env`.
 * The app's own tsconfig has no Node types (and needs none), so the one global
 * they use is declared here instead of adding @types/node for it.
 */
declare const process: { env: Record<string, string | undefined> }
