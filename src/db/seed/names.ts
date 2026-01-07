/**
 * Locale-aware fake names for seed data.
 *
 * Invented surnames and given-name/surname pairs drawn from common Nordic
 * patterns. No real people, and deliberately no real gym chains either: every
 * tenant name in the blueprint is made up.
 */

import type { Rng } from '@/lib/rng';

export type NameLocale = 'sv-SE' | 'nb-NO' | 'da-DK' | 'fi-FI';

interface NamePool {
  readonly given: readonly string[];
  readonly family: readonly string[];
  readonly cities: readonly string[];
  readonly streets: readonly string[];
  readonly phonePrefix: string;
  readonly emailDomains: readonly string[];
}

const POOLS: Record<NameLocale, NamePool> = {
  'sv-SE': {
    given: [
      'Anna', 'Erik', 'Maria', 'Johan', 'Sara', 'Lars', 'Emma', 'Anders', 'Linnea', 'Karl',
      'Sofia', 'Mikael', 'Elin', 'Peter', 'Hanna', 'Fredrik', 'Ida', 'Daniel', 'Klara', 'Oskar',
      'Malin', 'Jonas', 'Amanda', 'Martin', 'Julia', 'Henrik', 'Ebba', 'Simon', 'Alva', 'Viktor',
      'Moa', 'Rasmus', 'Nora', 'Albin', 'Tove', 'Gustav', 'Signe', 'Axel', 'Vera', 'Filip',
    ],
    family: [
      'Andersson', 'Bergström', 'Lindqvist', 'Sandberg', 'Ekström', 'Holmberg', 'Nyström',
      'Sundqvist', 'Vikström', 'Åkerlund', 'Hedström', 'Falk', 'Wallin', 'Björk', 'Dahlgren',
      'Engström', 'Forslund', 'Gran', 'Hallberg', 'Isaksson', 'Jernberg', 'Kvist', 'Löfgren',
      'Malmqvist', 'Norlin', 'Ohlsson', 'Palmgren', 'Rundqvist', 'Strand', 'Tornberg',
    ],
    cities: [
      'Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Västerås', 'Örebro', 'Linköping', 'Helsingborg',
      'Jönköping', 'Norrköping', 'Lund', 'Umeå', 'Gävle', 'Borås', 'Södertälje', 'Eskilstuna',
    ],
    streets: [
      'Kungsgatan', 'Storgatan', 'Sveavägen', 'Drottninggatan', 'Industrivägen', 'Hamngatan',
      'Vasagatan', 'Järnvägsgatan', 'Nygatan', 'Skolgatan', 'Verkstadsgatan', 'Ringvägen',
    ],
    phonePrefix: '+4670',
    emailDomains: ['example.se', 'mail.example.se', 'post.example.se'],
  },
  'nb-NO': {
    given: [
      'Bjørn', 'Ingrid', 'Ole', 'Kari', 'Lars', 'Marit', 'Håkon', 'Silje', 'Kjetil', 'Anne',
      'Espen', 'Hanne', 'Trygve', 'Astrid', 'Magnus', 'Solveig', 'Eirik', 'Frida', 'Sindre', 'Live',
      'Vegard', 'Mathilde', 'Jonas', 'Thea', 'Henrik', 'Emilie', 'Ivar', 'Nora', 'Tobias', 'Amalie',
    ],
    family: [
      'Berg', 'Dalen', 'Fjeld', 'Gundersen', 'Haugland', 'Iversen', 'Jakobsen', 'Kvamme',
      'Lunde', 'Moen', 'Nordby', 'Osland', 'Rønning', 'Sæther', 'Tangen', 'Ulriksen',
      'Vik', 'Aarseth', 'Bjerke', 'Eide', 'Furuseth', 'Grimstad', 'Hovde', 'Jenssen',
    ],
    cities: [
      'Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Drammen', 'Fredrikstad', 'Kristiansand',
      'Tromsø', 'Sandnes', 'Ålesund', 'Bodø', 'Lillestrøm', 'Haugesund', 'Moss',
    ],
    streets: [
      'Storgata', 'Kongens gate', 'Industriveien', 'Havnegata', 'Skolegata', 'Parkveien',
      'Jernbanegata', 'Nygata', 'Bryggeveien', 'Sentrumsveien',
    ],
    phonePrefix: '+479',
    emailDomains: ['example.no', 'mail.example.no'],
  },
  'da-DK': {
    given: [
      'Mette', 'Jens', 'Camilla', 'Søren', 'Line', 'Mads', 'Louise', 'Rasmus', 'Signe', 'Kasper',
      'Trine', 'Anders', 'Maja', 'Frederik', 'Ida', 'Christian', 'Josefine', 'Nikolaj', 'Emma', 'Oliver',
      'Sofie', 'Magnus', 'Freja', 'Villads', 'Karla', 'Elias',
    ],
    family: [
      'Holm', 'Kjær', 'Lund', 'Møller', 'Bech', 'Dahl', 'Frandsen', 'Gade', 'Hvid', 'Juhl',
      'Krogh', 'Lauritsen', 'Munk', 'Nørgaard', 'Overgaard', 'Poulsgaard', 'Riis', 'Skov',
      'Thomsen', 'Vestergaard',
    ],
    cities: [
      'København', 'Aarhus', 'Odense', 'Aalborg', 'Esbjerg', 'Randers', 'Kolding', 'Horsens',
      'Vejle', 'Roskilde', 'Helsingør', 'Herning',
    ],
    streets: [
      'Vestergade', 'Nørrebrogade', 'Industrivej', 'Havnegade', 'Skolegade', 'Parkvej',
      'Jernbanegade', 'Torvegade', 'Søndergade',
    ],
    phonePrefix: '+452',
    emailDomains: ['example.dk', 'mail.example.dk'],
  },
  'fi-FI': {
    given: [
      'Mikko', 'Laura', 'Juha', 'Anni', 'Ville', 'Sanna', 'Antti', 'Elina', 'Jukka', 'Riikka',
      'Timo', 'Katri', 'Petri', 'Heidi', 'Janne', 'Noora', 'Tuomas', 'Suvi', 'Olli', 'Emmi',
      'Aleksi', 'Iida', 'Eero', 'Milla', 'Joonas', 'Veera',
    ],
    family: [
      'Virtanen', 'Korhonen', 'Nieminen', 'Mäkinen', 'Heikkilä', 'Laaksonen', 'Salminen',
      'Rantala', 'Koskinen', 'Lehtonen', 'Hakala', 'Peltola', 'Aaltonen', 'Kinnunen',
      'Turunen', 'Hämäläinen', 'Väisänen', 'Ojala', 'Saarinen', 'Tuominen',
    ],
    cities: [
      'Helsinki', 'Espoo', 'Tampere', 'Vantaa', 'Oulu', 'Turku', 'Jyväskylä', 'Lahti',
      'Kuopio', 'Pori', 'Joensuu', 'Vaasa',
    ],
    streets: [
      'Mannerheimintie', 'Kauppakatu', 'Teollisuuskatu', 'Satamakatu', 'Koulukatu', 'Puistotie',
      'Asemakatu', 'Rautatienkatu', 'Kirkkokatu',
    ],
    phonePrefix: '+35840',
    emailDomains: ['example.fi', 'mail.example.fi'],
  },
};

export interface FakePerson {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly birthYear: number;
}

/** Fold accents down to ASCII so generated email addresses stay plausible. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/å/g, 'a')
    .replace(/Å/g, 'A')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

export function personFor(rng: Rng, locale: NameLocale, seq: number, todayYear: number): FakePerson {
  const pool = POOLS[locale];
  const given = rng.pick(pool.given);
  const family = rng.pick(pool.family);
  const name = `${given} ${family}`;
  const domain = rng.pick(pool.emailDomains);
  const email = `${slugify(given)}.${slugify(family)}.${seq.toString(36)}@${domain}`;
  const phone = `${pool.phonePrefix}${String(rng.int(0, 9_999_999)).padStart(7, '0')}`;
  const birthYear = todayYear - Math.round(rng.around(38, 14, 16, 78));
  return { name, email, phone, birthYear };
}

export function cityFor(rng: Rng, locale: NameLocale): string {
  return rng.pick(POOLS[locale].cities);
}

export function addressFor(rng: Rng, locale: NameLocale): string {
  return `${rng.pick(POOLS[locale].streets)} ${rng.int(1, 180)}`;
}

export function localeForCountry(country: 'SE' | 'NO' | 'FI' | 'DK'): NameLocale {
  switch (country) {
    case 'SE':
      return 'sv-SE';
    case 'NO':
      return 'nb-NO';
    case 'FI':
      return 'fi-FI';
    case 'DK':
      return 'da-DK';
  }
}

export const CLASS_NAMES: readonly string[] = [
  'Spinning 45',
  'Spinning 60',
  'Bodypump',
  'Circuit',
  'HIIT 30',
  'Yoga Flow',
  'Yin Yoga',
  'Core',
  'Styrka Grund',
  'Boxing Fit',
  'Zumba',
  'Stretch & Mobility',
  'Rygg & Nacke',
  'Senior Fit',
  'Kettlebell',
  'Löpteknik',
];

export const INSTRUCTOR_ROLE_TITLES: readonly string[] = [
  'Instruktör',
  'Personlig tränare',
  'Gruppträningsansvarig',
];
