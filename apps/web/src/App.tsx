import { useEffect, useState } from "react";
import { api, formatError, type TypesInfo } from "./api.ts";
import { Connections } from "./components/Connections.tsx";
import { Hero } from "./components/Hero.tsx";
import { SchemaEditor } from "./components/SchemaEditor.tsx";
import { SchemaList } from "./components/SchemaList.tsx";

type Route = { page: "list" } | { page: "edit"; id: string | null } | { page: "connections" };

function parseRoute(hash: string): Route {
  const m = /^#\/schemas\/([^/]+)$/.exec(hash);
  if (m) {
    try {
      return { page: "edit", id: m[1] === "new" ? null : decodeURIComponent(m[1]!) };
    } catch {
      return { page: "list" };
    }
  }
  if (hash === "#/connections") return { page: "connections" };
  return { page: "list" };
}

export function navigate(hash: string): void {
  location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [types, setTypes] = useState<TypesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api.types().then(setTypes, (e: unknown) => setError(formatError(e)));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">mockgen</a>
        <nav>
          <a href="#/">Schemas</a>
          {/* Absent on an instance built without database targets — the routes behind it are not
              registered there, so the link would lead to a page that can only fail. */}
          {types?.dbTargets && <a href="#/connections">Connections</a>}
          <a href="/docs" target="_blank" rel="noreferrer">API docs</a>
        </nav>
      </header>
      {route.page === "list" && types && (
        <Hero typeCount={types.types.length} dbTargets={types.dbTargets} />
      )}
      <main>
        {error ? (
          <p className="error">Could not reach the server: {error}</p>
        ) : !types ? (
          <p className="muted">Loading…</p>
        ) : (
          route.page === "edit" ? (
            <SchemaEditor key={route.id ?? "new"} id={route.id} types={types} />
          ) : route.page === "connections" && types.dbTargets ? (
            // A bookmarked or hand-typed #/connections on a public instance falls through to the
            // schema list rather than rendering a panel whose every call would 404.
            <Connections />
          ) : (
            <SchemaList />
          )
        )}
      </main>
    </div>
  );
}
