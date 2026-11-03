import type { PreviewState } from "../usePreview.ts";

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="null">null</span>;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "null";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function Preview({ rows, warnings, issues, error, loading }: PreviewState) {
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  return (
    <section className="panel preview">
      <h3>
        Preview {loading && <span className="muted">updating…</span>}
      </h3>
      {error && <p className="error">{error}</p>}
      {issues.length > 0 && <p className="error">Fix the fields marked in red to update the preview.</p>}
      {warnings > 0 && <p className="warning">{warnings} formula error(s) produced empty values.</p>}
      {!rows.length && !error && !issues.length && <p className="muted">{loading ? "Generating…" : "Add a field to see sample rows."}</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c} title={text(r[c])}>{cell(r[c])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
