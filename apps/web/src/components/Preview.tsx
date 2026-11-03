import type { PreviewState } from "../usePreview.ts";

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="null">null</span>;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function Preview({ rows, warnings, error, loading }: PreviewState) {
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  return (
    <section className="panel preview">
      <h3>
        Preview {loading && <span className="muted">updating…</span>}
      </h3>
      {error && <p className="error">{error}</p>}
      {warnings > 0 && <p className="warning">{warnings} formula error(s) produced empty values.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c} title={String(cell(r[c]))}>{cell(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
