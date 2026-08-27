import catalogJson from '../../../py/eotc/gitsawe_catalog.js';

export type GitsaweDay = {
  ethiopianMonth: number;
  ethiopianDay: number;
  season: string;
  gitsawe: Record<string, unknown>;
  sinksar: Record<string, unknown>;
};

type GitsaweCatalog = {
  version: number;
  coverage: Record<string, string>;
  days: Record<string, GitsaweDay>;
};

const catalog = catalogJson as GitsaweCatalog;

export function gitsaweCoverage(): Record<string, string> {
  return { ...catalog.coverage };
}

export function fixedGitsaweOn(month: number, day: number): GitsaweDay | null {
  return catalog.days[`${month}-${day}`] ?? null;
}
