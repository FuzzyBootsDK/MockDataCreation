const FORMATS = ["CSV", "JSON", "NDJSON", "SQL"];

export function Hero({ typeCount }: { typeCount: number }) {
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
        <p className="hero-lead">
          Design a schema from {typeCount} field types, preview it live, then export it, seed a database or serve it as a
          mock REST API.
        </p>
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
