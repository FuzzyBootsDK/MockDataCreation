import type { Faker } from "@faker-js/faker";
import { z } from "zod";
import type { ColumnType } from "../columns.ts";
import { DateFormatOption, formatDate, isoDateString } from "./dates.ts";
import { defineType, type FieldType } from "./registry.ts";

type Entry = [path: string, label: string, column?: ColumnType];

// Each path is "<module>.<method>" on a Faker instance, called with no arguments.
const CATALOG: Record<string, Entry[]> = {
  Person: [
    ["person.firstName", "First name"],
    ["person.lastName", "Last name"],
    ["person.middleName", "Middle name"],
    ["person.fullName", "Full name"],
    ["person.prefix", "Name prefix"],
    ["person.suffix", "Name suffix"],
    ["person.sex", "Sex"],
    ["person.gender", "Gender"],
    ["person.jobTitle", "Job title"],
    ["person.jobArea", "Job area"],
    ["person.jobType", "Job type"],
    ["person.bio", "Bio"],
    ["person.zodiacSign", "Zodiac sign"],
  ],
  Internet: [
    ["internet.email", "Email"],
    ["internet.username", "Username"],
    ["internet.displayName", "Display name"],
    ["internet.password", "Password"],
    ["internet.url", "URL"],
    ["internet.domainName", "Domain name"],
    ["internet.ipv4", "IPv4 address"],
    ["internet.ipv6", "IPv6 address"],
    ["internet.mac", "MAC address"],
    ["internet.port", "Port", "int"],
    ["internet.httpMethod", "HTTP method"],
    ["internet.httpStatusCode", "HTTP status code", "int"],
    ["internet.userAgent", "User agent"],
    ["internet.emoji", "Emoji"],
  ],
  Location: [
    ["location.streetAddress", "Street address"],
    ["location.street", "Street name"],
    ["location.buildingNumber", "Building number"],
    ["location.secondaryAddress", "Secondary address"],
    ["location.city", "City"],
    ["location.state", "State"],
    ["location.county", "County"],
    ["location.zipCode", "Postal code"],
    ["location.country", "Country"],
    ["location.countryCode", "Country code"],
    ["location.latitude", "Latitude", "decimal"],
    ["location.longitude", "Longitude", "decimal"],
    ["location.timeZone", "Time zone"],
    ["location.direction", "Direction"],
  ],
  Company: [
    ["company.name", "Company name"],
    ["company.catchPhrase", "Catch phrase"],
    ["company.buzzPhrase", "Buzz phrase"],
  ],
  Finance: [
    ["finance.iban", "IBAN"],
    ["finance.bic", "BIC"],
    ["finance.accountNumber", "Account number"],
    ["finance.accountName", "Account name"],
    ["finance.routingNumber", "Routing number"],
    ["finance.creditCardNumber", "Credit card number"],
    ["finance.creditCardCVV", "Credit card CVV"],
    ["finance.creditCardIssuer", "Credit card issuer"],
    ["finance.currencyCode", "Currency code"],
    ["finance.currencyName", "Currency name"],
    ["finance.amount", "Amount"],
    ["finance.transactionType", "Transaction type"],
    ["finance.transactionDescription", "Transaction description"],
    ["finance.bitcoinAddress", "Bitcoin address"],
  ],
  Commerce: [
    ["commerce.productName", "Product name"],
    ["commerce.product", "Product"],
    ["commerce.productAdjective", "Product adjective"],
    ["commerce.productMaterial", "Product material"],
    ["commerce.productDescription", "Product description"],
    ["commerce.department", "Department"],
    ["commerce.price", "Price"],
    ["commerce.isbn", "ISBN"],
  ],
  Phone: [
    ["phone.number", "Phone number"],
    ["phone.imei", "IMEI"],
  ],
  Text: [
    ["lorem.word", "Word"],
    ["lorem.words", "Words"],
    ["lorem.sentence", "Sentence"],
    ["lorem.sentences", "Sentences"],
    ["lorem.paragraph", "Paragraph"],
    ["lorem.paragraphs", "Paragraphs"],
    ["lorem.slug", "Slug"],
    ["word.adjective", "Adjective"],
    ["word.noun", "Noun"],
    ["word.verb", "Verb"],
    ["hacker.phrase", "Hacker phrase"],
    ["hacker.abbreviation", "Tech abbreviation"],
  ],
  Vehicle: [
    ["vehicle.vehicle", "Vehicle"],
    ["vehicle.manufacturer", "Manufacturer"],
    ["vehicle.model", "Model"],
    ["vehicle.type", "Vehicle type"],
    ["vehicle.fuel", "Fuel type"],
    ["vehicle.vin", "VIN"],
    ["vehicle.vrm", "Registration mark"],
    ["vehicle.color", "Vehicle color"],
  ],
  Misc: [
    ["color.human", "Color name"],
    ["color.rgb", "Color hex"],
    ["animal.type", "Animal type"],
    ["animal.dog", "Dog breed"],
    ["animal.cat", "Cat breed"],
    ["music.genre", "Music genre"],
    ["music.songName", "Song name"],
    ["book.title", "Book title"],
    ["book.author", "Book author"],
    ["food.dish", "Dish"],
    ["food.fruit", "Fruit"],
    ["food.vegetable", "Vegetable"],
    ["airline.flightNumber", "Flight number"],
  ],
  System: [
    ["system.fileName", "File name"],
    ["system.fileExt", "File extension"],
    ["system.mimeType", "MIME type"],
    ["system.semver", "Semantic version"],
    ["system.directoryPath", "Directory path"],
    ["database.column", "Database column"],
    ["database.type", "Database type"],
    ["database.engine", "Database engine"],
    ["git.commitSha", "Git commit SHA"],
    ["git.branch", "Git branch"],
  ],
};

function callPath(faker: Faker, path: string): unknown {
  const [mod, fn] = path.split(".") as [string, string];
  const module = (faker as unknown as Record<string, Record<string, () => unknown>>)[mod]!;
  return module[fn]!.call(module);
}

const simpleTypes: FieldType[] = Object.entries(CATALOG).flatMap(([category, entries]) =>
  entries.map(([path, label, column]) =>
    defineType({
      key: path,
      category,
      label,
      column: column ?? "text",
      generate: (_o, ctx) => callPath(ctx.faker, path),
    }),
  ),
);

const dateColumn = (o: { format: "datetime" | "date" }): ColumnType => (o.format === "date" ? "date" : "datetime");

const dateTypes: FieldType[] = [
  defineType({
    key: "date.between",
    category: "Date",
    label: "Date between",
    options: z
      .object({ from: isoDateString.default("2020-01-01"), to: isoDateString.default("2030-12-31"), format: DateFormatOption })
      .refine((o) => Date.parse(o.from) <= Date.parse(o.to), { message: "from must be before to", path: ["from"] }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.between({ from: o.from, to: o.to }), o.format),
  }),
  defineType({
    key: "date.past",
    category: "Date",
    label: "Date in the past",
    options: z.object({ years: z.number().positive().max(200).default(1), format: DateFormatOption }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.past({ years: o.years }), o.format),
  }),
  defineType({
    key: "date.future",
    category: "Date",
    label: "Date in the future",
    options: z.object({ years: z.number().positive().max(200).default(1), format: DateFormatOption }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.future({ years: o.years }), o.format),
  }),
  defineType({
    key: "date.birthdate",
    category: "Date",
    label: "Birthdate",
    options: z
      .object({ minAge: z.number().int().min(0).max(120).default(18), maxAge: z.number().int().min(0).max(120).default(80) })
      .refine((o) => o.minAge <= o.maxAge, { message: "minAge must be ≤ maxAge", path: ["minAge"] }),
    column: "date",
    generate: (o, ctx) =>
      formatDate(ctx.faker.date.birthdate({ mode: "age", min: o.minAge, max: o.maxAge }), "date"),
  }),
];

export const fakerCatalog: FieldType[] = [...simpleTypes, ...dateTypes];
