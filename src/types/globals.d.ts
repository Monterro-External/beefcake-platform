/**
 * Next.js writes `next-env.d.ts` on its first build, which is where the
 * side-effect CSS import declaration normally comes from. Declaring it here as
 * well means `npm run typecheck` works on a clean clone, before anything has
 * been built.
 */
declare module '*.css';
