import { z } from "zod";

export const DateFormatOption = z.enum(["datetime", "date"]).default("datetime");
export type DateFormat = z.output<typeof DateFormatOption>;

export function formatDate(d: Date, format: DateFormat): string {
  const iso = d.toISOString();
  return format === "date" ? iso.slice(0, 10) : iso;
}

export const isoDateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date");
