const FORMATS = ["CSV", "JSON", "NDJSON", "SQL"];

/**
 * `dbTargets` is false on a public instance (DB_TARGETS=0), and that changes what this may claim.
 *
 * The lead is the first sentence anyone reads, so promising "seed a database" on an instance with
 * no database routes is the worst place in the app to be wrong. Dropping the claim silently would
 * be the other mistake: it would undersell a feature that works in full one `docker compose up`
 * away. So it says both — not from here, and where it does work.
 */
export function Hero({ typeCount, dbTargets }: { typeCount: number; dbTargets: boolean }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-content">
        <p className="hero-eyebrow">Mock data generator</p>
        <h1 id="hero-title">
          Realistic test data,
          <br />
          <span>generated in seconds.</span>
        </h1>
        {dbTargets ? (
          <p className="hero-lead">
            Design a schema from {typeCount} field types, preview it live, then export it, seed a database or serve it as a
            mock REST API.
          </p>
        ) : (
          <p className="hero-lead">
            Design a schema from {typeCount} field types, preview it live, then export it or serve it as a mock REST API.
            It seeds PostgreSQL, SQL Server and SQLite too — on a copy you run yourself, which takes one{" "}
            <code>docker compose up</code>.
          </p>
        )}
        <div className="hero-actions">
          <a className="hero-cta" href="#/schemas/new">Create a schema →</a>
          <a className="hero-ghost" href="/docs" target="_blank" rel="noreferrer">API docs</a>
        </div>
        <ul className="hero-chips">
          <li><strong>{typeCount}</strong> field types</li>
          <li>{FORMATS.join(" · ")}</li>
          <li>Seeded &amp; repeatable</li>
          <li>Mock API endpoints</li>
        </ul>
      </div>
    </section>
  );
}
