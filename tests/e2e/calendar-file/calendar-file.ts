import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '../evidence';
import { seededToday, signIn, withDb } from '../helpers';

// Shared steps for specs/calendar-file.md.

export interface MemberLogin {
  readonly userId: string;
  readonly memberId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  readonly loginEmail: string;
  readonly phone: string;
  readonly homeSiteId: string;
  readonly allSites: boolean;
}

export interface ClassRow {
  readonly id: string;
  readonly name: string;
  readonly siteId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
  readonly booked: number;
  readonly waitlisted: number;
}

export interface SiteRow {
  readonly name: string;
  readonly addressLine: string;
  readonly city: string;
}

/** The seeded member logins at a tenant, in persona-switcher order. */
export function memberLogins(tenantName: string): MemberLogin[] {
  return withDb(
    (db) =>
      db
        .prepare(
          `select u.id as userId, m.id as memberId, t.id as tenantId, m.name, m.email,
                  u.email as loginEmail, m.phone, m.home_site_id as homeSiteId,
                  p.sites_scope = 'all_sites' as allSites
             from users u
             join tenants t on t.id = u.tenant_id
             join members m on m.id = u.member_id
             join subscriptions s on s.member_id = m.id and s.status = 'active'
             join plans p on p.id = s.plan_id
            where u.role = 'member' and t.name = ? and m.status = 'active'
            order by u.id`,
        )
        .all(tenantName) as MemberLogin[],
  ).map((login) => ({ ...login, allSites: Boolean(login.allSites) }));
}

/** A seeded member login by full name. */
export function memberNamed(tenantName: string, name: string): MemberLogin {
  const login = memberLogins(tenantName).find((candidate) => candidate.name === name);
  if (login === undefined) throw new Error(`No member login ${name} at ${tenantName}`);
  return login;
}

/**
 * Classes on the member schedule that have not started: from tomorrow (so none
 * starts while the test runs) to six days out (inside the schedule's week), at
 * a site this member can book, not cancelled.
 */
export function upcomingClasses(login: MemberLogin): ClassRow[] {
  return withDb(
    (db) =>
      db
        .prepare(
          `select c.id, c.name, c.site_id as siteId, c.starts_at as startsAt, c.ends_at as endsAt, c.capacity,
                  (select count(*) from bookings b where b.class_id = c.id
                     and b.status in ('booked','attended','no_show')) as booked,
                  (select count(*) from bookings b where b.class_id = c.id and b.status = 'waitlisted') as waitlisted
             from classes c
            where c.tenant_id = ?
              and c.cancelled = 0
              and (? or c.site_id = ?)
              and c.starts_at > ? and c.starts_at < ?
            order by c.starts_at, c.id`,
        )
        .all(login.tenantId, login.allSites ? 1 : 0, login.homeSiteId, ...scheduleWindow()) as ClassRow[],
  );
}

/**
 * A member login with nothing to send: no booking of any status on a class that
 * has not started. The seed keeps one such login per tenant; a test that books
 * as them leaves a booking behind, so this asks for a fresh seed when none is left.
 */
export function memberWithNothingToSend(tenantName: string): MemberLogin {
  // From the start of the seeded day: earlier than any class that has not started.
  const today = `${seededToday()}T00:00:00.000Z`;
  const idle = memberLogins(tenantName).find((login) =>
    withDb(
      (db) =>
        (
          db
            .prepare(
              `select count(*) as n from bookings b join classes c on c.id = b.class_id
                where b.member_id = ? and c.starts_at >= ?`,
            )
            .get(login.memberId, today) as { n: number }
        ).n === 0,
    ),
  );
  if (idle === undefined) {
    throw new Error(`No member login at ${tenantName} with nothing booked ahead; run npm run db:reset -- --scale small`);
  }
  return idle;
}

/**
 * A member login with no booking on a class that has not started other than
 * cancelled ones, and a class with room at a site they can book that they have
 * never booked. Never at `notAt`, so the login a nothing-to-send scenario
 * relies on there stays untouched. Earlier runs leave cancelled bookings
 * behind, which is why cancelled ones are allowed.
 */
export function memberWithNothingBooked(notAt: string): { member: MemberLogin; klass: ClassRow } {
  const today = `${seededToday()}T00:00:00.000Z`;
  const tenants = withDb((db) =>
    db
      .prepare("select name from tenants where name != ? order by name")
      .all(notAt)
      .map((row) => (row as { name: string }).name),
  );
  for (const tenant of tenants) {
    for (const member of memberLogins(tenant)) {
      const ahead = withDb(
        (db) =>
          db
            .prepare(
              `select b.class_id as classId, b.status from bookings b join classes c on c.id = b.class_id
                where b.member_id = ? and c.starts_at >= ?`,
            )
            .all(member.memberId, today) as { classId: string; status: string }[],
      );
      if (ahead.some((booking) => booking.status !== 'cancelled')) continue;
      const touched = new Set(ahead.map((booking) => booking.classId));
      const klass = upcomingClasses(member).find(
        (candidate) => !touched.has(candidate.id) && freePlaces(candidate) > 0,
      );
      if (klass !== undefined) return { member, klass };
    }
  }
  throw new Error(`No member login outside ${notAt} with nothing booked ahead; run npm run db:reset -- --scale small`);
}

function scheduleWindow(): [string, string] {
  const today = new Date(`${seededToday()}T00:00:00.000Z`);
  const day = 86_400_000;
  return [
    new Date(today.getTime() + day - 1).toISOString(),
    new Date(today.getTime() + 6 * day).toISOString(),
  ];
}

/** Class ids this member holds a booking on that is not cancelled. */
export function heldClassIds(memberId: string): Set<string> {
  return new Set(
    withDb((db) =>
      db
        .prepare("select class_id as classId from bookings where member_id = ? and status != 'cancelled'")
        .all(memberId)
        .map((row) => (row as { classId: string }).classId),
    ),
  );
}

export function siteOf(siteId: string): SiteRow {
  return withDb(
    (db) =>
      db
        .prepare('select name, address_line as addressLine, city from sites where id = ?')
        .get(siteId) as SiteRow,
  );
}

export function bookingStatus(classId: string, memberId: string): string | null {
  return withDb((db) => {
    const row = db
      .prepare('select status from bookings where class_id = ? and member_id = ?')
      .get(classId, memberId) as { status: string } | undefined;
    return row?.status ?? null;
  });
}

/** Booked bookings this member holds on classes that run and start after `at`. */
export function bookedCountAfter(memberId: string, at: string): number {
  return withDb(
    (db) =>
      (
        db
          .prepare(
            `select count(*) as n from bookings b join classes c on c.id = b.class_id
              where b.member_id = ? and b.status = 'booked' and c.cancelled = 0 and c.starts_at > ?`,
          )
          .get(memberId, at) as { n: number }
      ).n,
  );
}

export function freePlaces(klass: ClassRow): number {
  return klass.capacity - klass.booked;
}

export function overlaps(a: ClassRow, b: ClassRow): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export interface PromotionSetup {
  /** Oskar in the scenario: waits for the full class and holds a fallback. */
  readonly waiting: MemberLogin;
  /** Takes the last place on the full class and later gives it back. */
  readonly other: MemberLogin;
  /** Spinning 45 in the scenario. */
  readonly full: ClassRow;
  /** Core in the scenario: overlaps the full class and has room. */
  readonly fallback: ClassRow;
}

/**
 * Two members who can book at the same site, a class there with one place left
 * and nobody waiting, and an overlapping class with room. Puls Träning first;
 * its Solna timetable has no overlapping classes on the small seed, so the
 * search moves on to the next tenant whose timetable does.
 */
export function findPromotionSetup(): PromotionSetup {
  const tenants = withDb((db) =>
    db
      .prepare(
        `select t.name from tenants t
          where (select count(*) from users u where u.tenant_id = t.id and u.role = 'member') >= 2
          order by t.name = 'Puls Träning' desc, t.name`,
      )
      .all()
      .map((row) => (row as { name: string }).name),
  );
  for (const tenant of tenants) {
    const logins = memberLogins(tenant);
    for (const waiting of logins) {
      for (const other of logins) {
        if (other.memberId === waiting.memberId) continue;
        const heldByWaiting = heldClassIds(waiting.memberId);
        const heldByOther = heldClassIds(other.memberId);
        const othersClasses = new Set(upcomingClasses(other).map((klass) => klass.id));
        const classes = upcomingClasses(waiting);
        for (const full of classes) {
          if (full.waitlisted !== 0 || freePlaces(full) !== 1) continue;
          if (heldByWaiting.has(full.id) || heldByOther.has(full.id) || !othersClasses.has(full.id)) continue;
          const fallback = classes.find(
            (candidate) =>
              candidate.id !== full.id &&
              candidate.siteId === full.siteId &&
              overlaps(candidate, full) &&
              freePlaces(candidate) > 0 &&
              !heldByWaiting.has(candidate.id),
          );
          if (fallback !== undefined) return { waiting, other, full, fallback };
        }
      }
    }
  }
  throw new Error('No full class with an overlapping fallback class in the seeded timetable');
}

/** Act as this member on every surface and open their schedule. */
export async function openSchedule(page: Page, context: BrowserContext, login: MemberLogin): Promise<void> {
  await context.clearCookies();
  await signIn(context, login.userId);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: `Hej ${login.name.split(' ')[0]}` })).toBeVisible();
}

export function classRow(page: Page, klass: ClassRow) {
  return page.locator(`tr[data-class-id="${klass.id}"]`);
}

export async function book(page: Page, klass: ClassRow): Promise<void> {
  const row = classRow(page, klass);
  await row.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(row.getByText('Booked', { exact: true })).toBeVisible();
}

export async function joinWaitlist(page: Page, klass: ClassRow): Promise<void> {
  const row = classRow(page, klass);
  await row.getByRole('button', { name: 'Join waitlist', exact: true }).click();
  await expect(row.getByText(/^Waiting/)).toBeVisible();
}

export async function cancel(page: Page, klass: ClassRow): Promise<void> {
  const row = classRow(page, klass);
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row.getByRole('button', { name: /^(Book|Join waitlist)$/ })).toBeVisible();
}

/** Run the waitlist promotion job for one tenant, as the scheduler would. */
export function runPromotion(tenantId: string): void {
  execFileSync('npx', ['tsx', 'src/jobs/cli.ts', 'waitlist-promote', '--tenant', tenantId, '--quiet'], {
    env: { ...process.env, BEEFCAKE_DB: resolve(process.env.BEEFCAKE_DB ?? 'data/beefcake.db') },
    stdio: 'pipe',
  });
}

// ---------------------------------------------------------------------------
// The calendar file
// ---------------------------------------------------------------------------

export interface DownloadedFile {
  readonly filename: string;
  readonly text: string;
  readonly stampedAt: string;
  readonly events: readonly DownloadedEvent[];
}

export interface DownloadedEvent {
  readonly uid: string;
  readonly summary: string;
  readonly location: string;
  readonly description: string;
  readonly status: string;
  /** ISO instants, converted from the file's UTC form. */
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Press the schedule's calendar button and read the file the browser saved. */
export async function downloadCalendarFile(page: Page): Promise<DownloadedFile> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Add my booked classes to your calendar' }).click();
  const download = await downloading;
  const path = await download.path();
  return parseCalendarFile(download.suggestedFilename(), readFileSync(path, 'utf8'));
}

export function parseCalendarFile(filename: string, text: string): DownloadedFile {
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n');
  const events: DownloadedEvent[] = [];
  let stampedAt = '';
  let current: Map<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = new Map();
      continue;
    }
    if (line === 'END:VEVENT' && current !== null) {
      events.push({
        uid: current.get('UID') ?? '',
        summary: current.get('SUMMARY') ?? '',
        location: current.get('LOCATION') ?? '',
        description: current.get('DESCRIPTION') ?? '',
        status: current.get('STATUS') ?? '',
        startsAt: instant(current.get('DTSTART') ?? ''),
        endsAt: instant(current.get('DTEND') ?? ''),
      });
      stampedAt = instant(current.get('DTSTAMP') ?? '');
      current = null;
      continue;
    }
    if (current === null) continue;
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).split(';')[0] ?? '';
    current.set(name, unescape(line.slice(colon + 1)));
  }
  return { filename, text, stampedAt, events };
}

/** Events for this class: same name, same start. */
export function eventsFor(file: DownloadedFile, klass: ClassRow): DownloadedEvent[] {
  return file.events.filter(
    (event) => event.summary === klass.name && event.startsAt === new Date(klass.startsAt).toISOString(),
  );
}

/** '20260827T160000Z' as an ISO instant. */
function instant(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (m === null) throw new Error(`Not an absolute UTC time: ${value}`);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`).toISOString();
}

function unescape(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

/** The wall-clock time of an instant in a timezone, 'HH:MM'. */
export function wallClock(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(at),
  );
}
