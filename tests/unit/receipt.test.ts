import { describe, expect, it } from 'vitest';
import { currencyForLocale, renderReceipt } from '@/lib/receipt';

const receipt = {
  number: '202608-100001',
  issuedAt: '2026-08-25T03:05:00.000Z',
  totalMinor: 54900,
  vatMinor: 10980,
  linesJson: JSON.stringify([
    { description: 'Kraft Standard', quantity: 31, unit: 'day', amountMinor: 54900, currency: 'NOK' },
  ]),
};

describe('the billing currency for a market', () => {
  it('is the currency the operator sells in', () => {
    expect(currencyForLocale('sv-SE')).toBe('SEK');
    expect(currencyForLocale('da-DK')).toBe('DKK');
    expect(currencyForLocale('fi-FI')).toBe('EUR');
  });
});

describe('rendering', () => {
  it('formats the total, the VAT and every line', () => {
    const rendered = renderReceipt(receipt, 'sv-SE');
    expect(rendered.number).toBe('202608-100001');
    expect(rendered.lines).toHaveLength(1);
    expect(rendered.total).toContain('549');
    expect(rendered.vat).toContain('109');
  });

  it('keeps the receipt number and issue date untouched', () => {
    const rendered = renderReceipt(receipt, 'fi-FI');
    expect(rendered.number).toBe(receipt.number);
    expect(rendered.issuedAt).toBe(receipt.issuedAt);
  });

  it('does not warn for a locale that has a billing currency', () => {
    expect(renderReceipt(receipt, 'sv-SE').localeWarning).toBeNull();
  });
});
