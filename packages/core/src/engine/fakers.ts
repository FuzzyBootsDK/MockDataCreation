import { Faker, allLocales, base, en, type LocaleDefinition } from "@faker-js/faker";

// Fixed so relative dates (past/future/birthdate) do not drift from day to day.
export const REF_DATE = "2026-01-01T00:00:00.000Z";

const locales = allLocales as Record<string, LocaleDefinition>;

export const LOCALES: string[] = Object.keys(locales).filter((k) => k !== "base").sort();

export function isKnownLocale(code: string): boolean {
  return Object.hasOwn(locales, code) && code !== "base";
}

export function createFaker(locale: string): Faker {
  const def = isKnownLocale(locale) ? locales[locale]! : en;
  const faker = new Faker({ locale: [def, en, base] });
  faker.setDefaultRefDate(REF_DATE);
  return faker;
}
