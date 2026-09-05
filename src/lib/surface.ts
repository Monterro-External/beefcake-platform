/**
 * The three surfaces and the URL prefix each one lives under.
 *
 * Kept free of database imports because the middleware, which runs on the edge
 * runtime, needs it too.
 */

export type Surface = 'tenant' | 'member' | 'admin';

export const SURFACE_PATHS: Record<Surface, string> = {
  tenant: '/app',
  member: '/me',
  admin: '/admin',
};

/**
 * Set by the middleware from the request path. Server components and actions
 * cannot see the URL they are rendering for, and the default persona has to fit
 * the surface: an owner landing on the member app is signed in as nobody.
 */
export const SURFACE_HEADER = 'x-beefcake-surface';

export function surfaceOf(pathname: string): Surface | null {
  for (const [surface, path] of Object.entries(SURFACE_PATHS) as [Surface, string][]) {
    if (pathname === path || pathname.startsWith(`${path}/`)) return surface;
  }
  return null;
}

export function parseSurface(value: string | null | undefined): Surface | null {
  return value !== null && value !== undefined && value in SURFACE_PATHS ? (value as Surface) : null;
}
