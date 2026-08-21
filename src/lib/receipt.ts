/**
 * Rendering a receipt.
 *
 * A receipt is the one document a member keeps. It goes to their employer for a
 * wellness allowance and to their accountant at the end of the year, so the
 * numbers on it have to be formatted for the market it was issued in: a Swedish
 * receipt reads "399,00 kr", a Finnish one "39,00 €".
 *
 * The operator's locale decides that formatting, and it also decides which
 * currency the operator bills in, so both come from the same place.
 */

import type { Currency } from '@/domain/money';
import { format as formatMoney, money } from '@/domain/money';
import type { Locale } from './format';

export interface ReceiptLine {
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface ReceiptInput {
  readonly number: string;
  readonly issuedAt: string;
  readonly totalMinor: number;
  readonly vatMinor: number;
  readonly linesJson: string;
}

export interface RenderedReceipt {
  readonly number: string;
  readonly issuedAt: string;
  readonly currency: Currency;
  readonly total: string;
  readonly vat: string;
  readonly lines: { description: string; amount: string }[];
  /** Set when the operator's locale has no currency configured. */
  readonly localeWarning: string | null;
}

/**
 * The currency an operator in each of our markets bills in.
 *
 * Keeping this next to the renderer means a receipt is formatted and priced from
 * one fact about the operator rather than two that can drift apart.
 */
const CURRENCY_BY_LOCALE: Partial<Record<Locale, Currency>> = {
  'sv-SE': 'SEK',
  'da-DK': 'DKK',
  'fi-FI': 'EUR',
  en: 'SEK',
};

/** Swedish operators are the overwhelming majority. */
const FALLBACK_CURRENCY: Currency = 'SEK';

export function currencyForLocale(locale: Locale): Currency {
  return CURRENCY_BY_LOCALE[locale] ?? FALLBACK_CURRENCY;
}

export function renderReceipt(receipt: ReceiptInput, locale: Locale): RenderedReceipt {
  const currency = currencyForLocale(locale);
  const configured = CURRENCY_BY_LOCALE[locale] !== undefined;
  const lines = JSON.parse(receipt.linesJson) as ReceiptLine[];

  return {
    number: receipt.number,
    issuedAt: receipt.issuedAt,
    currency,
    total: formatMoney(money(receipt.totalMinor, currency), locale),
    vat: formatMoney(money(receipt.vatMinor, currency), locale),
    lines: lines.map((line) => ({
      description: line.description,
      amount: formatMoney(money(line.amountMinor, currency), locale),
    })),
    localeWarning: configured
      ? null
      : `No billing currency configured for locale ${locale}, formatting as ${FALLBACK_CURRENCY}`,
  };
}
