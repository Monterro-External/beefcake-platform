/**
 * Signing somebody up.
 *
 * The front desk conversation is about a minute long, so the form is what fits
 * in a minute: who they are, which gym, which plan. Everything else has a
 * sensible default and can be changed later.
 */

import { Card, PageHeader } from '@/components/ui';
import { NewMemberForm } from './form';
import { NotAllowed } from '@/components/layout/not-allowed';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { amount } from '@/lib/format';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as tenantsRepo from '@/db/repositories/tenants';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function NewMemberPage() {
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;
  if (!can(session, 'members.write')) {
    return <NotAllowed title="New member" role={session.user.role} what="sign members up" />;
  }

  const scope = tenantScopeFor(session);
  const sites = tenantsRepo.listSites(scope);
  const plans = subscriptionsRepo.listPlans(scope, { activeOnly: true });
  const today = clock().today(timezoneForCountry(tenant.country));
  const locale = tenant.locale;

  return (
    <>
      <PageHeader title="New member" subtitle={`Joining ${tenant.name} today, ${today}`} />
      <div className="max-w-2xl">
        <Card>
          <NewMemberForm
            sites={sites.map((site) => ({ id: site.id, name: site.name }))}
            plans={plans.map((plan) => ({
              id: plan.id,
              label: `${plan.name} · ${amount(plan.priceMinor, plan.currency, locale)}${plan.bindingMonths > 0 ? ` · ${plan.bindingMonths} months binding` : ''}`,
            }))}
            currentYear={Number.parseInt(today.slice(0, 4), 10)}
          />
        </Card>
      </div>
    </>
  );
}
