import { type SQL, and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { type Member, members, sites, subscriptions } from '../schema';
import { type TenantScope, guard, guardOne } from './scope';

export interface MemberFilter {
  readonly search?: string;
  readonly siteId?: string;
  readonly status?: Member['status'];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The filter conditions, built once and used by both the page of rows and the
 * count. Building them twice is how a list ends up saying "1,369 matching" over
 * eight search results.
 */
function memberConditions(scope: TenantScope, filter: MemberFilter) {
  const conditions = [eq(members.tenantId, scope.tenantId)];
  if (filter.siteId !== undefined) conditions.push(eq(members.homeSiteId, filter.siteId));
  if (filter.status !== undefined) conditions.push(eq(members.status, filter.status));
  const match = memberSearchCondition(filter.search);
  if (match !== undefined) conditions.push(match);
  return conditions;
}

/**
 * The member search rule: a case-insensitive substring of the name, email,
 * phone or card number. The term is trimmed; a term of only spaces is no
 * search and gives `undefined`. Shared by the member list and the open-dunning
 * report so "found" means the same on both screens. Case is folded with
 * `fold_case()` (see `openDatabase()`), not SQLite's ASCII-only `lower()`, so
 * Å, Ä, Ö, Ø and Æ match in either case.
 */
export function memberSearchCondition(search: string | undefined): SQL | undefined {
  if (search === undefined || search.trim().length === 0) return undefined;
  // `%`, `_` and `\` are matched as themselves, never as LIKE wildcards.
  const term = `%${search.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
  const contains = (value: SQL | typeof members.phone) => sql`${value} like ${term} escape '\\'`;
  return or(
    contains(sql`fold_case(${members.name})`),
    contains(sql`fold_case(${members.email})`),
    contains(members.phone),
    contains(sql`fold_case(coalesce(${members.cardId}, ''))`),
  );
}

export function listMembers(scope: TenantScope, filter: MemberFilter = {}): Member[] {
  return guard(
    scope,
    'members',
    scope.db
      .select()
      .from(members)
      .where(and(...memberConditions(scope, filter)))
      .orderBy(asc(members.name))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0)
      .all(),
  );
}

export function countMembers(
  scope: TenantScope,
  filter: Omit<MemberFilter, 'limit' | 'offset'> = {},
): number {
  const row = scope.db
    .select({ n: count() })
    .from(members)
    .where(and(...memberConditions(scope, filter)))
    .get();
  return row?.n ?? 0;
}

export function getMember(scope: TenantScope, memberId: string): Member | null {
  return guardOne(
    scope,
    'members',
    scope.db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, scope.tenantId), eq(members.id, memberId)))
      .get(),
  );
}

export function findByCard(scope: TenantScope, cardId: string): Member | null {
  return guardOne(
    scope,
    'members',
    scope.db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, scope.tenantId), eq(members.cardId, cardId)))
      .get(),
  );
}

export interface MemberWithSite {
  readonly member: Member;
  readonly siteName: string;
}

export function listMembersWithSite(scope: TenantScope, filter: MemberFilter = {}): MemberWithSite[] {
  const rows = listMembers(scope, filter);
  const siteRows = scope.db
    .select({ id: sites.id, name: sites.name, tenantId: sites.tenantId })
    .from(sites)
    .where(eq(sites.tenantId, scope.tenantId))
    .all();
  guard(scope, 'sites', siteRows);
  const names = new Map(siteRows.map((s) => [s.id, s.name]));
  return rows.map((member) => ({ member, siteName: names.get(member.homeSiteId) ?? 'Unknown site' }));
}

export function updateMemberStatus(
  scope: TenantScope,
  memberId: string,
  status: Member['status'],
): void {
  scope.db
    .update(members)
    .set({ status })
    .where(and(eq(members.tenantId, scope.tenantId), eq(members.id, memberId)))
    .run();
}

/** Members with no subscription row at all. Used by the onboarding runbook. */
export function membersWithoutSubscription(scope: TenantScope, limit = 100): Member[] {
  return guard(
    scope,
    'members',
    scope.db
      .select({
        id: members.id,
        tenantId: members.tenantId,
        homeSiteId: members.homeSiteId,
        name: members.name,
        email: members.email,
        phone: members.phone,
        status: members.status,
        cardId: members.cardId,
        birthYear: members.birthYear,
        joinedOn: members.joinedOn,
        createdAt: members.createdAt,
      })
      .from(members)
      .leftJoin(subscriptions, eq(subscriptions.memberId, members.id))
      .where(and(eq(members.tenantId, scope.tenantId), sql`${subscriptions.id} is null`))
      .orderBy(desc(members.joinedOn))
      .limit(limit)
      .all(),
  );
}
