import catalogJson from '../../../py/eotc/sinq_catalog.js';

export type SinqReading = {
  slot: string;
  sourceSlot: string;
  reference: {
    sourceBookTitle: string | null;
    bibleBook: string | null;
    familyMatch: boolean | null;
    chapter: number | null;
    verseStart: number | null;
    verseEnd: number | null;
    endText: string | null;
    endNote: string | null;
    sourceCitation: string | null;
  };
  textAvailable: { geez: boolean; amharic: boolean; english: boolean };
};

export type SinqService = {
  sourceService: string;
  readings: Record<string, SinqReading[]>;
  anaphora: string[];
};

export type SinqDaily = {
  id: string;
  cycle: 'fixed';
  ethiopianMonth: number;
  ethiopianDay: number;
  title: string | null;
  synaxariumNoteCount: number;
  provenance: Record<string, string>;
  services: Record<string, SinqService>;
};

export type SinqSeasonal = {
  id: string;
  cycle: 'seasonal';
  season: string;
  week: number | null;
  part: number | null;
  sourceKey: string;
  movable: boolean;
  title: string | null;
  provenance: string;
  services: Record<string, SinqService>;
};

export type SinqMonthly = {
  id: string;
  cycle: 'monthly';
  month: string;
  monthNum: number | null;
  match: {
    appliesTo: string;
    fromDay: number | null;
    toDay: number | null;
    nthSunday: number | null;
    crossMonth: boolean;
  };
  mezmur: string | null;
  sourceKey: string;
  title: string | null;
  provenance: string;
  services: Record<string, SinqService>;
};

export type SinqFeast = {
  id: string;
  sourceKey: string;
  name: string;
  amharicName: string;
  month: string | null;
  monthNum: number | null;
  day: number | null;
  dateKey: string | null;
  movable: boolean;
  provenance: string;
};

export type SinqSubFeast = {
  id: string;
  sourceKey: string;
  name: string;
  amharicName: string;
  feast: string;
  provenance: string;
};

export type SinqMahlet = {
  id: string;
  title: string;
  subFeast: string;
  chantSource: string | null;
  chants: { role: string }[];
  chantTextAvailable: boolean;
  provenance: string;
};

type SinqCatalog = {
  version: number;
  source: Record<string, string>;
  daily: Record<string, SinqDaily>;
  seasonal: SinqSeasonal[];
  monthly: SinqMonthly[];
  feasts: SinqFeast[];
  subFeasts: SinqSubFeast[];
  mahlets: SinqMahlet[];
  months: { key: string; name: string; amharicName: string }[];
  packages: { key: string; name: Record<string, string> }[];
};

const catalog = catalogJson as SinqCatalog;

export function sinqCatalog(): SinqCatalog {
  return catalog;
}

export function sinqDailyOn(month: number, day: number): SinqDaily | null {
  return catalog.daily[`${month}-${day}`] ?? null;
}

export function sinqSeasonal(): SinqSeasonal[] {
  return catalog.seasonal;
}

export function sinqMonthly(): SinqMonthly[] {
  return catalog.monthly;
}

export function sinqFeasts(): SinqFeast[] {
  return catalog.feasts;
}

export function sinqSubFeasts(): SinqSubFeast[] {
  return catalog.subFeasts;
}

export function sinqMahlets(): SinqMahlet[] {
  return catalog.mahlets;
}
