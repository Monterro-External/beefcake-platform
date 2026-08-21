/**
 * The twelve tenants in the development seed: a sample of the real book of
 * business, one of each shape we have to keep working. Counts are the ones we
 * actually see, so a report screen that is slow at Nordic Fitness Group is slow
 * here too.
 *
 * All names are invented.
 */

import type { Timezone } from '@/domain/dates';
import type { Currency } from '@/domain/money';
import type { AccessProviderName } from '@/integrations/types';
import type { NameLocale } from './names';

export type Country = 'SE' | 'NO' | 'FI' | 'DK';
export type Segment = 'long_tail' | 'mid' | 'key_account';
export type PlanTier = 'starter' | 'growth' | 'enterprise';

export interface SiteBlueprint {
  readonly name: string;
  readonly country: Country;
  readonly accessProvider: AccessProviderName;
}

export interface PlanBlueprint {
  readonly name: string;
  /** Major units in the tenant currency, e.g. 399 for 399,00 kr. */
  readonly price: number;
  readonly bindingMonths: number;
  readonly sitesScope: 'home_site' | 'all_sites';
  /** Relative popularity when assigning members to plans. */
  readonly weight: number;
}

export interface TenantBlueprint {
  readonly key: string;
  readonly name: string;
  readonly country: Country;
  readonly currency: Currency;
  readonly locale: NameLocale;
  readonly segment: Segment;
  readonly planTier: PlanTier;
  readonly members: number;
  readonly sites: readonly SiteBlueprint[];
  readonly plans: readonly PlanBlueprint[];
  /** Explicit tenant_settings rows. Anything absent falls back to the default. */
  readonly settings: Readonly<Record<string, string>>;
  /** Share of members who change plan in a given year. */
  readonly planChangeRate: number;
  /** Share of members who take at least one freeze per year. */
  readonly freezeRate: number;
  /** Base monthly charge failure rate. */
  readonly failureRate: number;
  /** Base monthly voluntary churn rate. */
  readonly churnRate: number;
  /** Share of members using the member app in a month. */
  readonly appAdoption: number;
  /** Mean share of class capacity booked. */
  readonly fillRate: number;
}

const TZ_BY_COUNTRY: Record<Country, Timezone> = {
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki',
  DK: 'Europe/Copenhagen',
};

export function timezoneFor(country: Country): Timezone {
  return TZ_BY_COUNTRY[country];
}

const A: AccessProviderName = 'access-provider-a';
const B: AccessProviderName = 'access-provider-b';

function seSites(names: readonly string[], provider: AccessProviderName = A): SiteBlueprint[] {
  return names.map((name) => ({ name, country: 'SE', accessProvider: provider }));
}

export const TENANTS: readonly TenantBlueprint[] = [
  // ---------------------------------------------------------------- long tail
  {
    key: 'gymmet-vasastan',
    name: 'Gymmet Vasastan',
    country: 'SE',
    currency: 'SEK',
    locale: 'sv-SE',
    segment: 'long_tail',
    planTier: 'starter',
    members: 520,
    sites: seSites(['Vasastan']),
    plans: [
      { name: 'Bas', price: 349, bindingMonths: 0, sitesScope: 'home_site', weight: 55 },
      { name: 'Bas 12', price: 279, bindingMonths: 12, sitesScope: 'home_site', weight: 30 },
      { name: 'Allt Inkluderat', price: 549, bindingMonths: 0, sitesScope: 'home_site', weight: 15 },
    ],
    settings: { notice_period_days: '30' },
    planChangeRate: 0.06,
    freezeRate: 0.14,
    failureRate: 0.038,
    churnRate: 0.022,
    appAdoption: 0.31,
    fillRate: 0.72,
  },
  {
    key: 'traningsverket-lund',
    name: 'Träningsverket Lund',
    country: 'SE',
    currency: 'SEK',
    locale: 'sv-SE',
    segment: 'long_tail',
    planTier: 'starter',
    members: 680,
    sites: seSites(['Lund Centrum'], B),
    plans: [
      { name: 'Student', price: 249, bindingMonths: 0, sitesScope: 'home_site', weight: 45 },
      { name: 'Standard', price: 399, bindingMonths: 0, sitesScope: 'home_site', weight: 40 },
      { name: 'Standard 12', price: 319, bindingMonths: 12, sitesScope: 'home_site', weight: 15 },
    ],
    settings: { flag_self_serve_freeze: 'true' },
    planChangeRate: 0.11,
    freezeRate: 0.24,
    failureRate: 0.047,
    churnRate: 0.031,
    appAdoption: 0.42,
    fillRate: 0.81,
  },
  {
    key: 'bodyfokus-umea',
    name: 'Bodyfokus Umeå',
    country: 'SE',
    currency: 'SEK',
    locale: 'sv-SE',
    segment: 'long_tail',
    planTier: 'starter',
    members: 450,
    sites: seSites(['Umeå Teg']),
    plans: [
      { name: 'Bas', price: 379, bindingMonths: 0, sitesScope: 'home_site', weight: 60 },
      { name: 'Bas 12', price: 299, bindingMonths: 12, sitesScope: 'home_site', weight: 40 },
    ],
    settings: { access_grace_hours: '24' },
    planChangeRate: 0.04,
    freezeRate: 0.19,
    failureRate: 0.035,
    churnRate: 0.024,
    appAdoption: 0.22,
    fillRate: 0.68,
  },
  {
    key: 'trening-grunerlokka',
    name: 'Trening Grünerløkka',
    country: 'NO',
    currency: 'NOK',
    locale: 'nb-NO',
    segment: 'long_tail',
    planTier: 'starter',
    members: 600,
    sites: [{ name: 'Grünerløkka', country: 'NO', accessProvider: A }],
    plans: [
      { name: 'Standard', price: 449, bindingMonths: 0, sitesScope: 'home_site', weight: 55 },
      { name: 'Standard 12', price: 379, bindingMonths: 12, sitesScope: 'home_site', weight: 30 },
      { name: 'Morgen', price: 329, bindingMonths: 0, sitesScope: 'home_site', weight: 15 },
    ],
    settings: { notice_period_days: '30' },
    planChangeRate: 0.05,
    freezeRate: 0.16,
    failureRate: 0.04,
    churnRate: 0.026,
    appAdoption: 0.36,
    fillRate: 0.74,
  },
  {
    key: 'kuntoklubi-kallio',
    name: 'Kuntoklubi Kallio',
    country: 'FI',
    currency: 'EUR',
    locale: 'fi-FI',
    segment: 'long_tail',
    planTier: 'starter',
    members: 780,
    sites: [{ name: 'Kallio', country: 'FI', accessProvider: B }],
    plans: [
      { name: 'Perus', price: 39, bindingMonths: 0, sitesScope: 'home_site', weight: 50 },
      { name: 'Perus 12', price: 32, bindingMonths: 12, sitesScope: 'home_site', weight: 30 },
      { name: 'Premium', price: 59, bindingMonths: 0, sitesScope: 'home_site', weight: 20 },
    ],
    // Kallio runs late: the door is open until midnight six days a week.
    settings: { flag_member_app: 'true', access_grace_hours: '48' },
    planChangeRate: 0.07,
    freezeRate: 0.21,
    failureRate: 0.045,
    churnRate: 0.029,
    appAdoption: 0.47,
    fillRate: 0.79,
  },
  {
    key: 'fitness-norrebro',
    name: 'Fitness Nørrebro',
    country: 'DK',
    currency: 'DKK',
    locale: 'da-DK',
    segment: 'long_tail',
    planTier: 'starter',
    members: 520,
    sites: [{ name: 'Nørrebro', country: 'DK', accessProvider: A }],
    plans: [
      { name: 'Basis', price: 279, bindingMonths: 0, sitesScope: 'home_site', weight: 60 },
      { name: 'Basis 6', price: 239, bindingMonths: 6, sitesScope: 'home_site', weight: 40 },
    ],
    settings: {},
    planChangeRate: 0.05,
    freezeRate: 0.15,
    failureRate: 0.036,
    churnRate: 0.027,
    appAdoption: 0.28,
    fillRate: 0.7,
  },

  // ---------------------------------------------------------------------- mid
  {
    key: 'puls-traning',
    name: 'Puls Träning',
    country: 'SE',
    currency: 'SEK',
    locale: 'sv-SE',
    segment: 'mid',
    planTier: 'growth',
    members: 2400,
    sites: seSites(['Solna', 'Sundbyberg', 'Kista', 'Täby']),
    plans: [
      { name: 'Ett Gym', price: 399, bindingMonths: 0, sitesScope: 'home_site', weight: 40 },
      { name: 'Alla Gym', price: 549, bindingMonths: 0, sitesScope: 'all_sites', weight: 35 },
      { name: 'Alla Gym 12', price: 449, bindingMonths: 12, sitesScope: 'all_sites', weight: 20 },
      { name: 'Ungdom', price: 249, bindingMonths: 0, sitesScope: 'home_site', weight: 5 },
    ],
    settings: { flag_new_reports: 'true', notice_period_days: '30' },
    planChangeRate: 0.14,
    freezeRate: 0.2,
    failureRate: 0.042,
    churnRate: 0.025,
    appAdoption: 0.51,
    fillRate: 0.83,
  },
  {
    key: 'aktiv-halsa',
    name: 'Aktiv Hälsa',
    country: 'SE',
    currency: 'SEK',
    locale: 'sv-SE',
    segment: 'mid',
    planTier: 'growth',
    members: 1150,
    sites: seSites(['Örebro Norr', 'Örebro Syd'], B),
    plans: [
      { name: 'Hälsa Bas', price: 429, bindingMonths: 0, sitesScope: 'all_sites', weight: 50 },
      { name: 'Hälsa Plus', price: 629, bindingMonths: 0, sitesScope: 'all_sites', weight: 30 },
      { name: 'Hälsa Bas 12', price: 349, bindingMonths: 12, sitesScope: 'all_sites', weight: 20 },
    ],
    settings: {
      notice_period_days: '60',
      max_freeze_months: '2',
      // Their finance team asked for a slower, longer dunning cycle.
      retry_attempts: '4',
      retry_interval_days: '7',
    },
    planChangeRate: 0.09,
    freezeRate: 0.17,
    failureRate: 0.031,
    churnRate: 0.019,
    appAdoption: 0.38,
    fillRate: 0.76,
  },
  {
    key: 'vestkyst-trening',
    name: 'Vestkyst Trening',
    country: 'NO',
    currency: 'NOK',
    locale: 'nb-NO',
    segment: 'mid',
    planTier: 'growth',
    members: 1700,
    sites: [
      { name: 'Bergen Sentrum', country: 'NO', accessProvider: A },
      { name: 'Åsane', country: 'NO', accessProvider: A },
      { name: 'Stavanger', country: 'NO', accessProvider: B },
    ],
    plans: [
      { name: 'Ett Senter', price: 499, bindingMonths: 0, sitesScope: 'home_site', weight: 40 },
      { name: 'Alle Sentre', price: 649, bindingMonths: 0, sitesScope: 'all_sites', weight: 35 },
      { name: 'Alle Sentre 12', price: 549, bindingMonths: 12, sitesScope: 'all_sites', weight: 25 },
    ],
    settings: { flag_self_serve_freeze: 'true' },
    planChangeRate: 0.1,
    freezeRate: 0.18,
    failureRate: 0.048,
    churnRate: 0.028,
    appAdoption: 0.44,
    fillRate: 0.8,
  },
  {
    key: 'voima-kuntosalit',
    name: 'Voima Kuntosalit',
    country: 'FI',
    currency: 'EUR',
    locale: 'fi-FI',
    segment: 'mid',
    planTier: 'growth',
    members: 3100,
    sites: [
      { name: 'Tampere Keskusta', country: 'FI', accessProvider: B },
      { name: 'Tampere Hervanta', country: 'FI', accessProvider: B },
      { name: 'Jyväskylä', country: 'FI', accessProvider: B },
      { name: 'Kuopio', country: 'FI', accessProvider: A },
      { name: 'Oulu', country: 'FI', accessProvider: A },
    ],
    plans: [
      { name: 'Yksi Sali', price: 42, bindingMonths: 0, sitesScope: 'home_site', weight: 35 },
      { name: 'Kaikki Salit', price: 56, bindingMonths: 0, sitesScope: 'all_sites', weight: 35 },
      { name: 'Kaikki Salit 12', price: 46, bindingMonths: 12, sitesScope: 'all_sites', weight: 25 },
      { name: 'Opiskelija', price: 29, bindingMonths: 0, sitesScope: 'home_site', weight: 5 },
    ],
    settings: { flag_new_reports: 'true', flag_member_app: 'true' },
    planChangeRate: 0.12,
    freezeRate: 0.22,
    failureRate: 0.039,
    churnRate: 0.023,
    appAdoption: 0.55,
    fillRate: 0.85,
  },

  // ------------------------------------------------------------- key accounts
  {
    key: 'nordic-fitness-group',
    name: 'Nordic Fitness Group',
    country: 'SE',
    currency: 'SEK',
    locale: 'sv-SE',
    segment: 'key_account',
    planTier: 'enterprise',
    members: 22000,
    sites: [
      ...seSites([
        'Stockholm City',
        'Stockholm Södermalm',
        'Stockholm Kungsholmen',
        'Solna Strand',
        'Göteborg Nordstan',
        'Göteborg Frölunda',
        'Malmö Centralen',
        'Malmö Hyllie',
        'Uppsala Centrum',
        'Linköping',
        'Västerås',
      ]),
      { name: 'Oslo Sentrum', country: 'NO', accessProvider: A },
      { name: 'Oslo Majorstuen', country: 'NO', accessProvider: A },
      { name: 'Bergen', country: 'NO', accessProvider: B },
      { name: 'Trondheim', country: 'NO', accessProvider: B },
    ],
    plans: [
      { name: 'Flex', price: 599, bindingMonths: 0, sitesScope: 'all_sites', weight: 30 },
      { name: 'Flex 12', price: 499, bindingMonths: 12, sitesScope: 'all_sites', weight: 25 },
      { name: 'Ett Center', price: 449, bindingMonths: 0, sitesScope: 'home_site', weight: 20 },
      { name: 'Premium', price: 899, bindingMonths: 0, sitesScope: 'all_sites', weight: 15 },
      { name: 'Ungdom', price: 299, bindingMonths: 0, sitesScope: 'home_site', weight: 10 },
    ],
    settings: {
      notice_period_days: '30',
      flag_new_reports: 'true',
      flag_member_app: 'true',
      flag_self_serve_freeze: 'true',
    },
    // Upgrades and downgrades between Flex and Premium are a monthly habit here.
    planChangeRate: 0.31,
    freezeRate: 0.23,
    failureRate: 0.066,
    churnRate: 0.034,
    appAdoption: 0.61,
    fillRate: 0.88,
  },
  {
    key: 'kraft-trening',
    name: 'Kraft Trening',
    country: 'NO',
    currency: 'NOK',
    locale: 'nb-NO',
    segment: 'key_account',
    planTier: 'enterprise',
    members: 9000,
    sites: [
      { name: 'Oslo Storo', country: 'NO', accessProvider: A },
      { name: 'Oslo Ryen', country: 'NO', accessProvider: A },
      { name: 'Drammen', country: 'NO', accessProvider: A },
      { name: 'Fredrikstad', country: 'NO', accessProvider: B },
      { name: 'Kristiansand', country: 'NO', accessProvider: B },
      { name: 'Stavanger Forus', country: 'NO', accessProvider: A },
      { name: 'Bergen Åsane', country: 'NO', accessProvider: A },
      { name: 'Trondheim Lade', country: 'NO', accessProvider: B },
    ],
    plans: [
      { name: 'Kraft Standard', price: 549, bindingMonths: 0, sitesScope: 'all_sites', weight: 35 },
      { name: 'Kraft Standard 12', price: 449, bindingMonths: 12, sitesScope: 'all_sites', weight: 30 },
      { name: 'Kraft Ett Senter', price: 429, bindingMonths: 0, sitesScope: 'home_site', weight: 20 },
      { name: 'Kraft Pluss', price: 749, bindingMonths: 0, sitesScope: 'all_sites', weight: 15 },
    ],
    settings: { notice_period_days: '30', flag_new_reports: 'true', flag_member_app: 'true' },
    planChangeRate: 0.16,
    freezeRate: 0.19,
    failureRate: 0.052,
    churnRate: 0.027,
    appAdoption: 0.49,
    fillRate: 0.84,
  },
];

export type ScaleName = 'full' | 'small' | 'tiny';

export interface Scale {
  readonly name: ScaleName;
  /** Multiplier applied to member counts. */
  readonly memberFactor: number;
  /** Months of payment-run and subscription history. */
  readonly historyMonths: number;
  /** Days of class schedule before today. */
  readonly classDaysBack: number;
  /** Days of class schedule after today. */
  readonly classDaysForward: number;
  /** Days of check-in history. */
  readonly accessDaysBack: number;
  /** Share of members who check in on a given day. */
  readonly dailyVisitRate: number;
  /** Share of member-days that produce a product-usage event row. */
  readonly eventSampleRate: number;
}

export const SCALES: Record<ScaleName, Scale> = {
  full: {
    name: 'full',
    memberFactor: 1,
    historyMonths: 18,
    classDaysBack: 56,
    classDaysForward: 14,
    accessDaysBack: 90,
    dailyVisitRate: 0.14,
    eventSampleRate: 0.012,
  },
  small: {
    name: 'small',
    memberFactor: 0.08,
    historyMonths: 18,
    classDaysBack: 28,
    classDaysForward: 14,
    accessDaysBack: 45,
    dailyVisitRate: 0.14,
    eventSampleRate: 0.05,
  },
  tiny: {
    name: 'tiny',
    memberFactor: 0.02,
    // Same depth of history as full scale: the shape of the story has to be the
    // same one the tests assert on, only smaller.
    historyMonths: 18,
    classDaysBack: 14,
    classDaysForward: 14,
    accessDaysBack: 14,
    dailyVisitRate: 0.14,
    eventSampleRate: 0.1,
  },
};

/** The day of the month the monthly payment run goes out. */
export const PAYMENT_RUN_DAY = 25;

export const TOTAL_MEMBERS_AT_FULL_SCALE = TENANTS.reduce((acc, t) => acc + t.members, 0);
