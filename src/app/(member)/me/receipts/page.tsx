/**
 * My receipts.
 *
 * A member downloading a receipt for their employer's wellness allowance is the
 * only reason this screen exists, and it is a surprisingly common one. The
 * currency is the operator's, always: a Norwegian gym issues receipts in NOK
 * whoever is reading them.
 */

import { Badge, Card, EmptyState, PageHeader, TD, TH, THead, TR, Table } from '@/components/ui';
import { getSession, tenantScopeFor } from '@/lib/session';
import { amount, humanise, instant } from '@/lib/format';
import * as paymentsRepo from '@/db/repositories/payments';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

interface ReceiptLine {
  description: string;
  quantity: number;
  unit: string;
  amountMinor: number;
  currency: string;
}

export default async function MemberReceipts() {
  const session = await getSession();
  const member = session.member;
  const tenant = session.tenant;
  if (member === null || tenant === null) return null;

  const scope = tenantScopeFor(session);
  const timezone = timezoneForCountry(tenant.country);
  const locale = tenant.locale;

  const receipts = paymentsRepo.receiptsForMember(scope, member.id, 24);
  const charges = paymentsRepo.listCharges(scope, { memberId: member.id, limit: 24 });
  const open = charges.filter((charge) => charge.status === 'retrying' || charge.status === 'abandoned');

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle={`${tenant.name} · amounts in ${tenant.currency}`}
      />

      {open.length > 0 && (
        <div className="mb-4">
          <Card title="Outstanding">
            <Table>
              <THead>
                <TR>
                  <TH align="right">Amount</TH>
                  <TH>Why it failed</TH>
                  <TH align="right">Attempt</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {open.map((charge) => (
                  <TR key={charge.id}>
                    <TD align="right" mono>
                      {amount(charge.amountMinor, charge.currency, locale)}
                    </TD>
                    <TD>{humanise(charge.failureCode)}</TD>
                    <TD align="right">{charge.attempt}</TD>
                    <TD>
                      <Badge tone={charge.status === 'abandoned' ? 'bad' : 'warn'}>
                        {humanise(charge.status)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-ink-muted">
              We try again automatically. If it keeps failing, check your bank mandate or pay at the
              desk.
            </p>
          </Card>
        </div>
      )}

      <Card title={`Paid (${receipts.length})`}>
        {receipts.length === 0 ? (
          <EmptyState title="No receipts yet" hint="Your first one arrives after the next payment run." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Issued</TH>
                <TH>What for</TH>
                <TH align="right">VAT</TH>
                <TH align="right">Total</TH>
              </TR>
            </THead>
            <tbody>
              {receipts.map((receipt) => {
                const lines = JSON.parse(receipt.linesJson) as ReceiptLine[];
                return (
                  <TR key={receipt.id}>
                    <TD mono>{receipt.number}</TD>
                    <TD className="whitespace-nowrap">{instant(receipt.issuedAt, timezone, locale)}</TD>
                    <TD>{lines.map((line) => line.description).join(' + ')}</TD>
                    <TD align="right" mono className="text-ink-muted">
                      {amount(receipt.vatMinor, receipt.currency, locale)}
                    </TD>
                    <TD align="right" mono>
                      {amount(receipt.totalMinor, receipt.currency, locale)}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-ink-muted">
          Receipts older than six months are archived. Ask the front desk if you need one.
        </p>
      </Card>
    </>
  );
}
