import { useEffect, useState } from "react";
import type { Row, ValidationIssue } from "@mockgen/core";
import { ApiError, api, formatError } from "./api.ts";

export interface PreviewState {
  rows: Row[];
  warnings: number;
  issues: ValidationIssue[];
  error: string | null;
  loading: boolean;
}

export function usePreview(draft: unknown, delay = 300): PreviewState {
  const [state, setState] = useState<PreviewState>({ rows: [], warnings: 0, issues: [], error: null, loading: false });
  const json = draft ? JSON.stringify(draft) : "";

  useEffect(() => {
    if (!json) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      api.preview(JSON.parse(json)).then(
        (r) => !cancelled && setState({ rows: r.rows, warnings: r.warnings, issues: [], error: null, loading: false }),
        (e: unknown) =>
          !cancelled &&
          setState((s) => ({
            ...s,
            issues: e instanceof ApiError ? e.issues : [],
            error: e instanceof ApiError && e.issues.length ? null : formatError(e),
            loading: false,
          })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [json, delay]);

  return state;
}
