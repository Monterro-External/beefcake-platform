/**
 * The development session.
 *
 * There is no real authentication in this repo (see the plan for what is out of
 * scope). Instead a cookie names a user, and the persona switcher in the header
 * changes it. Everything downstream treats the resolved user exactly as it would
 * a real one: the role gates what is visible, and the tenant on the user is what
 * the repository scope is built from.
 *
 * Two properties matter and are worth keeping if this is ever replaced by real
 * auth:
 *
 *  - The tenant comes from the *user record*, never from a URL or a form field.
 *    A request cannot ask to be scoped to another tenant.
 *  - Beefcake staff have no tenant. To look at one they impersonate, which is a
 *    deliberate, logged, read-only narrowing.
 */

import { cookies } from 'next/headers';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { members, sites, tenants, users } from '@/db/schema';
import type { Member, Site, Tenant, User } from '@/db/schema';
import { type Scope, adminScope, impersonate, tenantScope } from '@/db/repositories/scope';

export const SESSION_COOKIE = 'beefcake_dev_user';
export const IMPERSONATION_COOKIE = 'beefcake_dev_impersonating';

export type Role = User['role'];

export interface Session {
  readonly user: User;
  readonly tenant: Tenant | null;
  readonly site: Site | null;
  readonly member: Member | null;
  /** The tenant a Beefcake admin is currently looking at, read-only. */
  readonly impersonating: Tenant | null;
  readonly isBeefcakeStaff: boolean;
}

/** Roles that can act inside the tenant app, most privileged first. */
export const TENANT_ROLES: Role[] = ['owner', 'site_manager', 'front_desk'];

const ROLE_LABELS: Record<Role, string> = {
  beefcake_admin: 'Beefcake staff',
  owner: 'Owner',
  site_manager: 'Site manager',
  front_desk: 'Front desk',
  member: 'Member',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/**
 * Who can do what.
 *
 * Deliberately coarse: three tenant roles, and the difference between them is
 * about money and configuration, not about screens. Front desk does the day job
 * and cannot change what things cost.
 */
export const PERMISSIONS = {
  'members.read': ['owner', 'site_manager', 'front_desk'],
  'members.write': ['owner', 'site_manager', 'front_desk'],
  'subscriptions.write': ['owner', 'site_manager', 'front_desk'],
  'classes.write': ['owner', 'site_manager'],
  'payments.read': ['owner', 'site_manager'],
  'payments.run': ['owner'],
  'reports.read': ['owner', 'site_manager'],
  'reports.export': ['owner', 'site_manager'],
  'settings.read': ['owner', 'site_manager'],
  'settings.write': ['owner'],
  'access.read': ['owner', 'site_manager', 'front_desk'],
  // The member app. A member acts on their own record only, which the actions
  // enforce by comparing the session member to the subject.
  'self.book': ['member'],
  'self.subscription': ['member'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(session: Session, permission: Permission): boolean {
  if (session.isBeefcakeStaff) {
    // Impersonation is read-only. Support looks; it does not touch.
    return permission.endsWith('.read');
  }
  return (PERMISSIONS[permission] as readonly Role[]).includes(session.user.role);
}

export function requirePermission(session: Session, permission: Permission): void {
  if (!can(session, permission)) {
    throw new Error(`${roleLabel(session.user.role)} may not ${permission}`);
  }
}

// ---------------------------------------------------------------------------
// Resolving the session
// ---------------------------------------------------------------------------

/** The user the persona switcher lands on when no cookie is set. */
export function defaultUser(): User {
  const db = getDb();
  const owner = db
    .select()
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.role, 'owner'))
    .orderBy(asc(tenants.name))
    .get();
  if (owner !== undefined) return owner.users;
  const anyUser = db.select().from(users).orderBy(asc(users.email)).get();
  if (anyUser === undefined) {
    throw new Error('No users in the database. Run `npm run db:reset`.');
  }
  return anyUser;
}

export async function getSession(): Promise<Session> {
  const db = getDb();
  const jar = await cookies();
  const userId = jar.get(SESSION_COOKIE)?.value;

  const user =
    (userId === undefined ? undefined : db.select().from(users).where(eq(users.id, userId)).get()) ??
    defaultUser();

  const tenant =
    user.tenantId === null
      ? null
      : (db.select().from(tenants).where(eq(tenants.id, user.tenantId)).get() ?? null);

  const site =
    user.siteId === null ? null : (db.select().from(sites).where(eq(sites.id, user.siteId)).get() ?? null);

  const member =
    user.memberId === null
      ? null
      : (db.select().from(members).where(eq(members.id, user.memberId)).get() ?? null);

  const isBeefcakeStaff = user.role === 'beefcake_admin';
  const impersonatedId = isBeefcakeStaff ? jar.get(IMPERSONATION_COOKIE)?.value : undefined;
  const impersonating =
    impersonatedId === undefined
      ? null
      : (db.select().from(tenants).where(eq(tenants.id, impersonatedId)).get() ?? null);

  return { user, tenant, site, member, impersonating, isBeefcakeStaff };
}

/**
 * The repository scope for this session.
 *
 * Beefcake staff get an admin scope unless they are impersonating, in which case
 * they get a tenant scope narrowed to that tenant. Everyone else gets their own
 * tenant, from their user record.
 */
export function scopeFor(session: Session): Scope {
  const db = getDb();
  if (session.isBeefcakeStaff) {
    const admin = adminScope({ db, actorId: session.user.id });
    return session.impersonating === null ? admin : impersonate(admin, session.impersonating.id);
  }
  if (session.tenant === null) {
    throw new Error(`User ${session.user.id} has role ${session.user.role} but no tenant`);
  }
  return tenantScope(session.tenant.id, {
    db,
    actorId: session.user.id,
    actorRole: session.user.role,
  });
}

/** The tenant scope for a session that must have one. Throws for unimpersonating staff. */
export function tenantScopeFor(session: Session) {
  const scope = scopeFor(session);
  if (scope.kind !== 'tenant') {
    throw new Error('This screen needs a tenant. Pick one to impersonate first.');
  }
  return scope;
}

/** The tenant whose data is on screen, whether owned or impersonated. */
export function activeTenant(session: Session): Tenant | null {
  return session.isBeefcakeStaff ? session.impersonating : session.tenant;
}

// ---------------------------------------------------------------------------
// The persona switcher
// ---------------------------------------------------------------------------

export interface PersonaOption {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly tenantName: string | null;
  readonly siteName: string | null;
}

/**
 * Everyone the switcher can become, grouped by tenant with staff first.
 *
 * `currentUserId` is always included even if the trimming below would have
 * dropped them, because a `<select>` whose value is not among its options
 * silently displays the wrong person.
 */
export function personaOptions(currentUserId?: string): PersonaOption[] {
  const db = getDb();

  const staff = db
    .select({ user: users })
    .from(users)
    .where(and(eq(users.role, 'beefcake_admin'), isNull(users.tenantId)))
    .orderBy(asc(users.name))
    .all()
    .map(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantName: null,
      siteName: null,
    }));

  const tenantUsers = db
    .select({ user: users, tenantName: tenants.name, siteName: sites.name })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .leftJoin(sites, eq(sites.id, users.siteId))
    .orderBy(asc(tenants.name), asc(users.role), asc(users.name))
    .all()
    .map(({ user, tenantName, siteName }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantName,
      siteName,
    }));

  // One of each role per tenant is enough to switch between; the seed makes
  // three front desk users per site and nobody needs to scroll past them.
  const seen = new Set<string>();
  const trimmed = tenantUsers.filter((option) => {
    if (option.id === currentUserId) return true;
    const key = `${option.tenantName}|${option.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...staff, ...trimmed];
}
