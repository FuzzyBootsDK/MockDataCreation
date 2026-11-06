const REPO = "https://github.com/FuzzyBootsDK/MockDataCreation";

/**
 * Stands in for the Seed panel on an instance started with DB_TARGETS=0.
 *
 * The point is that seeding is **not** a missing feature — it is a feature this particular
 * deployment cannot safely offer, and it works in full on a copy the reader runs themselves. A
 * panel that just disappeared would read as "mockgen cannot do this", which is wrong and sells the
 * project short to exactly the person who came looking for it.
 *
 * It says why rather than only what. "No database routes here" invites a reader to assume the
 * author was lazy; the actual reason — a public instance has no accounts, so a database password
 * typed into it would be stored in plain text and readable by the next visitor — is both true and
 * the clearest argument for running your own.
 */
export function SeedElsewherePanel() {
  return (
    <section className="panel stack">
      <h3>Seed a database — on your own copy</h3>
      <p className="muted">
        mockgen can insert generated rows straight into <strong>PostgreSQL</strong>,{" "}
        <strong>SQL Server</strong> or <strong>SQLite</strong>, in <code>create</code>,{" "}
        <code>append</code> or <code>truncate</code> mode. It is one of the things it is for.
      </p>
      <p className="muted">
        Just not from here. This instance is public and has no accounts, so a database password
        typed into it would be stored in plain text and readable by the next visitor — and the
        server would be dialling a database on a stranger's behalf. This build therefore ships
        without the connection and seed routes at all.
      </p>
      <p className="muted">
        Run your own and you get them. Export this schema from the Schemas page
        (<strong>Export JSON</strong>), then:
      </p>
      <pre>{`git clone ${REPO}
cd MockDataCreation
docker compose up -d`}</pre>
      <p className="muted">
        Open <code>http://localhost:8080</code>, press <strong>Import JSON</strong>, and{" "}
        <strong>Seed database…</strong> is waiting in this spot. Everything else — every field
        type, every export format, the mock API — behaves identically on both, so a schema built
        here needs no changes there.
      </p>
      <p className="muted">
        <a href={`${REPO}#running-a-public-instance`} target="_blank" rel="noreferrer">
          Why a public instance leaves these routes out
        </a>
      </p>
    </section>
  );
}
