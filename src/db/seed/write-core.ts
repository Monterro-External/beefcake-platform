/**
 * Writes the tenants, sites, staff, plans, members, subscriptions and freezes.
 */

import { addDays, addMonths, plainDate } from '@/domain/dates';
import { createRng } from '@/lib/rng';
import { sequentialId } from '../ids';
import type { Sqlite } from '../client';
import { BulkInserter } from './writer';
import { addressFor, cityFor } from './names';
import { holdsCard, memberLogins } from './people';
import type { SeedWorld, TableCounts } from './model';
import type { Anchors } from './options';

export function writeCore(
  sqlite: Sqlite,
  world: SeedWorld,
  anchors: Anchors,
  seed: string,
  counts: TableCounts,
): void {
  const tenantRows = new BulkInserter(sqlite, 'tenants', [
    'id',
    'name',
    'orgNumber',
    'country',
    'currency',
    'locale',
    'segment',
    'planTier',
    'status',
    'createdAt',
  ]);
  const settingRows = new BulkInserter(sqlite, 'tenant_settings', [
    'tenantId',
    'key',
    'value',
    'updatedAt',
  ]);
  const siteRows = new BulkInserter(sqlite, 'sites', [
    'id',
    'tenantId',
    'name',
    'timezone',
    'addressLine',
    'city',
    'accessProvider',
    'openedOn',
  ]);
  const userRows = new BulkInserter(sqlite, 'users', [
    'id',
    'tenantId',
    'siteId',
    'email',
    'name',
    'role',
    'memberId',
    'createdAt',
  ]);
  const planRows = new BulkInserter(sqlite, 'plans', [
    'id',
    'tenantId',
    'name',
    'priceMinor',
    'currency',
    'interval',
    'bindingMonths',
    'sitesScope',
    'active',
    'createdAt',
  ]);
  const memberRows = new BulkInserter(sqlite, 'members', [
    'id',
    'tenantId',
    'homeSiteId',
    'name',
    'email',
    'phone',
    'status',
    'cardId',
    'birthYear',
    'joinedOn',
    'createdAt',
  ]);
  const subscriptionRows = new BulkInserter(sqlite, 'subscriptions', [
    'id',
    'tenantId',
    'memberId',
    'planId',
    'status',
    'startedOn',
    'endsOn',
    'bindingUntil',
    'cancelledOn',
    'noticeEndsOn',
    'cancelReason',
    'createdAt',
  ]);
  const freezeRows = new BulkInserter(sqlite, 'freezes', [
    'id',
    'tenantId',
    'subscriptionId',
    'startsOn',
    'endsOn',
    'months',
    'reason',
    'createdAt',
  ]);

  for (const staff of world.beefcakeStaff) {
    userRows.push({
      id: staff.id,
      tenantId: null,
      siteId: null,
      email: staff.email,
      name: staff.name,
      role: 'beefcake_admin',
      memberId: null,
      createdAt: `${addMonths(anchors.today, -40)}T08:00:00.000Z`,
    });
  }

  for (const tenant of world.tenants) {
    const rng = createRng(`${seed}|core|${tenant.id}`);
    tenantRows.push({
      id: tenant.id,
      name: tenant.blueprint.name,
      orgNumber: tenant.orgNumber,
      country: tenant.blueprint.country,
      currency: tenant.blueprint.currency,
      locale: tenant.blueprint.locale,
      segment: tenant.blueprint.segment,
      planTier: tenant.blueprint.planTier,
      status: 'active',
      createdAt: tenant.createdAt,
    });

    for (const [key, value] of Object.entries(tenant.blueprint.settings)) {
      settingRows.push({
        tenantId: tenant.id,
        key,
        value,
        updatedAt: `${addDays(tenant.createdOn, 3)}T10:00:00.000Z`,
      });
    }

    for (const site of tenant.sites) {
      siteRows.push({
        id: site.id,
        tenantId: tenant.id,
        name: site.name,
        timezone: site.timezone,
        addressLine: addressFor(rng, tenant.blueprint.locale),
        city: site.name.split(' ')[0] ?? cityFor(rng, tenant.blueprint.locale),
        accessProvider: site.accessProvider,
        openedOn: site.openedOn,
      });
    }

    for (const person of tenant.staff) {
      userRows.push({
        id: person.id,
        tenantId: tenant.id,
        siteId: person.siteIndex === null ? null : tenant.sites[person.siteIndex]?.id ?? null,
        email: person.email,
        name: person.name,
        role: person.role,
        memberId: null,
        createdAt: tenant.createdAt,
      });
    }

    for (const plan of tenant.plans) {
      planRows.push({
        id: plan.id,
        tenantId: tenant.id,
        name: plan.name,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        interval: 'month',
        bindingMonths: plan.bindingMonths,
        sitesScope: plan.sitesScope,
        active: true,
        createdAt: tenant.createdAt,
      });
    }

    for (const member of tenant.members) {
      const site = tenant.sites[member.siteIndex];
      memberRows.push({
        id: member.id,
        tenantId: tenant.id,
        homeSiteId: site?.id ?? tenant.sites[0]?.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        status: member.status,
        // Archived members have handed their card back at the desk.
        cardId: holdsCard(member) ? member.cardId : null,
        birthYear: member.birthYear,
        joinedOn: member.joinedOn,
        createdAt: `${member.joinedOn}T${String(rng.int(8, 20)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`,
      });

      subscriptionRows.push({
        id: member.subscriptionId,
        tenantId: tenant.id,
        memberId: member.id,
        planId: tenant.plans[member.planIndex]?.id ?? tenant.plans[0]?.id,
        status: member.subscriptionStatus,
        startedOn: member.startedOn,
        endsOn: member.endsOn,
        bindingUntil: member.bindingUntil,
        cancelledOn: member.cancelledOn,
        noticeEndsOn: member.noticeEndsOn,
        cancelReason: member.cancelReason,
        createdAt: `${member.joinedOn}T09:00:00.000Z`,
      });

      for (const freeze of member.freezes) {
        freezeRows.push({
          id: freeze.id,
          tenantId: tenant.id,
          subscriptionId: member.subscriptionId,
          startsOn: freeze.startsOn,
          endsOn: freeze.endsOn,
          months: freeze.months,
          reason: freeze.reason,
          createdAt: `${addDays(freeze.startsOn, -rng.int(0, 12))}T14:00:00.000Z`,
        });
      }
    }

    // A handful of member logins per tenant, so the dev persona switcher has
    // someone to be. Picked deterministically from the active base.
    for (const { member } of memberLogins(tenant.members)) {
      userRows.push({
        id: sequentialId('user', 500000 + member.seq),
        tenantId: tenant.id,
        siteId: tenant.sites[member.siteIndex]?.id ?? null,
        email: `login.${member.email}`,
        name: member.name,
        role: 'member',
        memberId: member.id,
        createdAt: `${member.joinedOn}T09:05:00.000Z`,
      });
    }
  }

  counts.tenants = tenantRows.flush();
  counts.tenant_settings = settingRows.flush();
  counts.sites = siteRows.flush();
  counts.plans = planRows.flush();
  counts.members = memberRows.flush();
  counts.subscriptions = subscriptionRows.flush();
  counts.freezes = freezeRows.flush();
  counts.users = userRows.flush();
  void plainDate;
}
