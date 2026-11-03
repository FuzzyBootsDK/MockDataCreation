import type { Row } from "../model.ts";

export function* toJsonArray(rows: Iterable<Row>): Generator<string> {
  let first = true;
  yield "[";
  for (const row of rows) {
    yield (first ? "\n" : ",\n") + JSON.stringify(row);
    first = false;
  }
  yield first ? "]\n" : "\n]\n";
}

export function* toNdjson(rows: Iterable<Row>): Generator<string> {
  for (const row of rows) yield JSON.stringify(row) + "\n";
}
