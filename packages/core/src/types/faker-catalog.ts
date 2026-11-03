import type { Faker } from "@faker-js/faker";
import { z } from "zod";
import type { ColumnType } from "../columns.ts";
import { DateFormatOption, formatDate, isoDateString } from "./dates.ts";
import { defineType, type FieldType } from "./registry.ts";

type Entry = [key: string, label: string, column?: ColumnType, call?: (f: Faker) => unknown];

const hex = (f: Faker, length: number) => f.string.hexadecimal({ length, casing: "lower", prefix: "" });

// Keys are stored in saved schemas, so never rename one; labels and categories are free to change.
// Without a `call`, the key is "<module>.<method>" on a Faker instance, called with no arguments.
const CATALOG: Record<string, Entry[]> = {
  Personal: [
    ["person.firstName", "First Name"],
    ["person.firstName.male", "First Name (Male)", undefined, (f) => f.person.firstName("male")],
    ["person.firstName.female", "First Name (Female)", undefined, (f) => f.person.firstName("female")],
    ["person.lastName", "Last Name"],
    ["person.middleName", "Middle Name"],
    ["person.fullName", "Full Name"],
    ["person.prefix", "Title"],
    ["person.suffix", "Suffix"],
    ["person.sex", "Gender (Binary)"],
    ["person.sex.abbrev", "Gender (Abbrev)", undefined, (f) => (f.person.sexType() === "male" ? "M" : "F")],
    ["person.gender", "Gender"],
    ["internet.email", "Email Address"],
    ["internet.exampleEmail", "Email Address (example.com)"],
    ["internet.username", "Username"],
    ["internet.displayName", "Display Name"],
    ["internet.password", "Password"],
    ["person.ssn", "SSN (US format)", undefined, (f) => f.helpers.replaceSymbols("###-##-####")],
    ["location.language", "Language", undefined, (f) => f.location.language().name],
    ["person.jobTitle", "Job Title"],
    ["person.jobArea", "Job Area"],
    ["person.jobType", "Job Type"],
    ["person.jobDescriptor", "Job Descriptor"],
    ["person.bio", "Bio"],
    ["person.zodiacSign", "Zodiac Sign"],
    ["image.avatar", "Avatar URL"],
    ["image.personPortrait", "Person Portrait URL"],
  ],
  Phone: [
    ["phone.number", "Phone"],
    ["phone.imei", "IMEI"],
  ],
  Location: [
    ["location.streetAddress", "Street Address"],
    ["location.street", "Street Name"],
    ["location.buildingNumber", "Street Number"],
    ["location.secondaryAddress", "Address Line 2"],
    ["location.city", "City"],
    ["location.state", "State"],
    ["location.state.abbrev", "State (abbrev)", undefined, (f) => f.location.state({ abbreviated: true })],
    ["location.county", "County"],
    ["location.zipCode", "Postal Code"],
    ["location.country", "Country"],
    ["location.countryCode", "Country Code"],
    ["location.countryCode.alpha3", "Country Code (alpha-3)", undefined, (f) => f.location.countryCode("alpha-3")],
    ["location.continent", "Continent"],
    ["location.latitude", "Latitude", "decimal"],
    ["location.longitude", "Longitude", "decimal"],
    ["location.timeZone", "Time Zone"],
    ["location.direction", "Direction"],
    ["location.cardinalDirection", "Cardinal Direction"],
    ["location.ordinalDirection", "Ordinal Direction"],
  ],
  Travel: [
    ["airline.airport.name", "Airport Name", undefined, (f) => f.airline.airport().name],
    ["airline.airport.code", "Airport Code", undefined, (f) => f.airline.airport().iataCode],
    ["airline.airline.name", "Airline Name", undefined, (f) => f.airline.airline().name],
    ["airline.airline.code", "Airline Code", undefined, (f) => f.airline.airline().iataCode],
    ["airline.airplane", "Airplane", undefined, (f) => f.airline.airplane().name],
    ["airline.aircraftType", "Aircraft Type"],
    ["airline.flightNumber", "Flight Number"],
    ["airline.seat", "Seat"],
    ["airline.recordLocator", "Booking Reference"],
  ],
  Company: [
    ["company.name", "Company Name"],
    ["company.catchPhrase", "Catch Phrase"],
    ["company.buzzPhrase", "Buzz Phrase"],
    ["company.buzzNoun", "Buzzword"],
    ["company.buzzVerb", "Buzz Verb"],
    ["company.buzzAdjective", "Buzz Adjective"],
    ["commerce.department", "Department"],
  ],
  Commerce: [
    ["commerce.productName", "Product Name"],
    ["commerce.product", "Product"],
    ["commerce.productAdjective", "Product Adjective"],
    ["commerce.productMaterial", "Product Material"],
    ["commerce.productDescription", "Product Description"],
    ["commerce.price", "Product Price"],
    ["commerce.isbn", "ISBN"],
    ["commerce.upc", "UPC"],
  ],
  Finance: [
    ["finance.amount", "Money"],
    ["finance.currencyCode", "Currency Code"],
    ["finance.currencyName", "Currency"],
    ["finance.currencySymbol", "Currency Symbol"],
    ["finance.creditCardNumber", "Credit Card #"],
    ["finance.creditCardCVV", "Credit Card CVV"],
    ["finance.creditCardIssuer", "Credit Card Type"],
    ["finance.iban", "IBAN"],
    ["finance.bic", "SWIFT / BIC"],
    ["finance.accountNumber", "Account Number"],
    ["finance.accountName", "Account Name"],
    ["finance.routingNumber", "Routing Number"],
    ["finance.pin", "PIN"],
    ["finance.transactionType", "Transaction Type"],
    ["finance.transactionDescription", "Transaction Description"],
  ],
  Crypto: [
    ["finance.bitcoinAddress", "Bitcoin Address"],
    ["finance.ethereumAddress", "Ethereum Address"],
    ["finance.litecoinAddress", "Litecoin Address"],
  ],
  IT: [
    ["internet.url", "URL"],
    ["internet.domainName", "Domain Name"],
    ["internet.domainWord", "Domain Word"],
    ["internet.domainSuffix", "Top Level Domain"],
    ["internet.protocol", "Protocol"],
    ["internet.ip", "IP Address"],
    ["internet.ipv4", "IP Address v4"],
    ["internet.ipv4.cidr", "IP Address v4 CIDR", undefined, (f) => `${f.internet.ipv4()}/${f.number.int({ min: 8, max: 32 })}`],
    ["internet.ipv6", "IP Address v6"],
    ["internet.ipv6.cidr", "IP Address v6 CIDR", undefined, (f) => `${f.internet.ipv6()}/${f.number.int({ min: 16, max: 128 })}`],
    ["internet.mac", "MAC Address"],
    ["internet.port", "Port", "int"],
    ["internet.httpMethod", "HTTP Method"],
    ["internet.httpStatusCode", "HTTP Status Code", "int"],
    ["internet.userAgent", "User Agent"],
    ["internet.jwt", "JWT"],
    ["internet.jwtAlgorithm", "JWT Algorithm"],
    ["internet.emoji", "Emoji"],
    ["app.name", "App Name", undefined, (f) => f.helpers.arrayElement([f.hacker.noun(), f.company.buzzNoun(), f.word.noun()]).replace(/^\w/, (c) => c.toUpperCase())],
    ["system.semver", "App Version"],
    ["app.bundleId", "App Bundle ID", undefined, (f) => `com.${f.internet.domainWord().replace(/[^a-z0-9]/g, "")}.${f.word.noun().toLowerCase().replace(/[^a-z0-9]/g, "")}`],
    ["database.mongodbObjectId", "MongoDB ObjectID"],
    ["string.ulid", "ULID"],
    ["string.nanoid", "Nano ID"],
    ["hash.md5", "MD5", undefined, (f) => hex(f, 32)],
    ["hash.sha1", "SHA1", undefined, (f) => hex(f, 40)],
    ["hash.sha256", "SHA256", undefined, (f) => hex(f, 64)],
    ["system.fileName", "File Name"],
    ["system.commonFileName", "Common File Name"],
    ["system.fileExt", "File Extension"],
    ["system.commonFileType", "File Type"],
    ["system.mimeType", "MIME Type"],
    ["system.directoryPath", "Directory Path"],
    ["system.filePath", "File Path"],
    ["system.networkInterface", "Network Interface"],
    ["system.cron", "Cron Expression"],
    ["database.column", "Database Column"],
    ["database.type", "Database Type"],
    ["database.engine", "Database Engine"],
    ["database.collation", "Database Collation"],
    ["git.commitSha", "Git Commit SHA"],
    ["git.branch", "Git Branch"],
    ["git.commitMessage", "Git Commit Message"],
    ["hacker.phrase", "Hacker Phrase"],
    ["hacker.abbreviation", "Tech Abbreviation"],
    ["hacker.noun", "Tech Noun"],
    ["hacker.verb", "Tech Verb"],
    ["hacker.adjective", "Tech Adjective"],
    ["hacker.ingverb", "Tech -ing Verb"],
  ],
  Color: [
    ["color.human", "Color"],
    ["color.rgb", "Hex Color"],
    ["color.hex.short", "Short Hex Color", undefined, (f) => `#${hex(f, 3)}`],
    ["color.rgb.css", "RGB Color", undefined, (f) => f.color.rgb({ format: "css" })],
    ["color.hsl.css", "HSL Color", undefined, (f) => f.color.hsl({ format: "css" })],
  ],
  Images: [
    ["image.url", "Image URL"],
    ["image.urlPicsumPhotos", "Dummy Image URL"],
  ],
  Car: [
    ["vehicle.vehicle", "Car"],
    ["vehicle.manufacturer", "Car Make"],
    ["vehicle.model", "Car Model"],
    ["vehicle.year", "Car Model Year", "int", (f) => f.number.int({ min: 1980, max: 2026 })],
    ["vehicle.type", "Car Type"],
    ["vehicle.fuel", "Fuel Type"],
    ["vehicle.vin", "Car VIN"],
    ["vehicle.vrm", "Registration Mark"],
    ["vehicle.color", "Car Color"],
    ["vehicle.bicycle", "Bicycle"],
  ],
  Nature: [
    ["animal.type", "Animal Type"],
    ["animal.dog", "Dog Breed"],
    ["animal.cat", "Cat Breed"],
    ["animal.bird", "Bird"],
    ["animal.fish", "Fish"],
    ["animal.horse", "Horse Breed"],
    ["animal.cow", "Cow Breed"],
    ["animal.bear", "Bear"],
    ["animal.lion", "Big Cat"],
    ["animal.snake", "Snake"],
    ["animal.insect", "Insect"],
    ["animal.rabbit", "Rabbit Breed"],
    ["animal.rodent", "Rodent"],
    ["animal.cetacean", "Whale / Dolphin"],
    ["animal.crocodilia", "Crocodilian"],
    ["animal.petName", "Pet Name"],
    ["science.chemicalElement", "Chemical Element", undefined, (f) => f.science.chemicalElement().name],
    ["science.chemicalSymbol", "Chemical Symbol", undefined, (f) => f.science.chemicalElement().symbol],
    ["science.unit", "Unit of Measure", undefined, (f) => f.science.unit().name],
  ],
  Food: [
    ["food.dish", "Dish"],
    ["food.description", "Dish Description"],
    ["food.ethnicCategory", "Cuisine"],
    ["food.ingredient", "Ingredient"],
    ["food.fruit", "Fruit"],
    ["food.vegetable", "Vegetable"],
    ["food.meat", "Meat"],
    ["food.spice", "Spice"],
    ["food.adjective", "Food Adjective"],
  ],
  Entertainment: [
    ["music.genre", "Music Genre"],
    ["music.songName", "Song Name"],
    ["music.artist", "Music Artist"],
    ["music.album", "Album"],
    ["book.title", "Book Title"],
    ["book.author", "Book Author"],
    ["book.genre", "Book Genre"],
    ["book.publisher", "Book Publisher"],
    ["book.series", "Book Series"],
    ["book.format", "Book Format"],
  ],
  Text: [
    ["lorem.word", "Word"],
    ["lorem.words", "Words"],
    ["lorem.sentence", "Sentence"],
    ["lorem.sentences", "Sentences"],
    ["lorem.paragraph", "Paragraph"],
    ["lorem.paragraphs", "Paragraphs"],
    ["lorem.lines", "Lines"],
    ["lorem.text", "Text"],
    ["lorem.slug", "Slug"],
    ["word.adjective", "Adjective"],
    ["word.adverb", "Adverb"],
    ["word.noun", "Noun"],
    ["word.verb", "Verb"],
    ["word.conjunction", "Conjunction"],
    ["word.interjection", "Interjection"],
    ["word.preposition", "Preposition"],
  ],
  Date: [
    ["date.month", "Month"],
    ["date.weekday", "Weekday"],
  ],
};

function callPath(faker: Faker, path: string): unknown {
  const [mod, fn] = path.split(".") as [string, string];
  const module = (faker as unknown as Record<string, Record<string, () => unknown>>)[mod]!;
  return module[fn]!.call(module);
}

const simpleTypes: FieldType[] = Object.entries(CATALOG).flatMap(([category, entries]) =>
  entries.map(([key, label, column, call]) =>
    defineType({
      key,
      category,
      label,
      column: column ?? "text",
      generate: (_o, ctx) => (call ? call(ctx.faker) : callPath(ctx.faker, key)),
    }),
  ),
);

const dateColumn = (o: { format: "datetime" | "date" }): ColumnType => (o.format === "date" ? "date" : "datetime");

const dateTypes: FieldType[] = [
  defineType({
    key: "date.between",
    category: "Date",
    label: "Datetime (between)",
    options: z
      .object({ from: isoDateString.default("2020-01-01"), to: isoDateString.default("2030-12-31"), format: DateFormatOption })
      .refine((o) => Date.parse(o.from) <= Date.parse(o.to), { message: "from must be before to", path: ["from"] }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.between({ from: o.from, to: o.to }), o.format),
  }),
  defineType({
    key: "date.past",
    category: "Date",
    label: "Datetime (past)",
    options: z.object({ years: z.number().positive().max(200).default(1), format: DateFormatOption }),
    column: dateColumn,
    generate: (o, ctx) => formatDate(ctx.faker.date.past({ years: o.years }), o.format),
  }),
  defineType({
    key: "date.future",
    category: "Date",
    label: "Datetime (future)",
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

const patternTypes: FieldType[] = [
  defineType({
    key: "characterSequence",
    category: "Basic",
    label: "Character Sequence",
    description: "A pattern: # digit, ? letter, * either, e.g. INV-#####",
    options: z.object({
      pattern: z.string().min(1, "Enter a pattern").max(200).describe("# digit, ? letter, * digit or letter").default("###-???"),
    }),
    column: "text",
    generate: (o, ctx) => ctx.faker.helpers.replaceSymbols(o.pattern),
  }),
  defineType({
    key: "time",
    category: "Date",
    label: "Time",
    options: z.object({ format: z.enum(["24h", "12h"]).default("24h") }),
    column: "text",
    generate: (o, ctx) => {
      const h = ctx.faker.number.int({ min: 0, max: 23 });
      const m = String(ctx.faker.number.int({ min: 0, max: 59 })).padStart(2, "0");
      if (o.format === "24h") return `${String(h).padStart(2, "0")}:${m}`;
      return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
    },
  }),
];

export const fakerCatalog: FieldType[] = [...simpleTypes, ...dateTypes, ...patternTypes];
