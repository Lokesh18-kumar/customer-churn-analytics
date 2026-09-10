# Customer Churn Analytics

Retain/IQ is a CSV-first customer churn analytics dashboard that profiles data quality, analyzes churn patterns, and turns measured signals into practical retention actions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/churn-analytics/src/App.tsx` — upload flow, dashboard views, charts, report/export controls, and responsive UI.
- `artifacts/churn-analytics/src/index.css` — Retain/IQ visual tokens, chart styling, motion, and print rules.
- `artifacts/api-server/src/routes/analyze.ts` — server-side profiling, quality checks, churn analysis, segmentation, insights, and recommendations.
- `lib/api-spec/openapi.yaml` — source-of-truth contract for the analysis request and response.

## Architecture decisions

- CSV bytes are parsed in the browser and sent as typed rows to the shared API; the original file is never silently overwritten.
- Analysis preserves outliers and duplicate/missing-value findings as explicit quality signals instead of hiding cleanup decisions.
- The API detects common churn target names and derives all dashboard values from the uploaded dataset.
- Categorical analysis records raw casing/whitespace variants, normalizes before grouping, and requires five observations before a group can drive risk recommendations.
- Report export uses a readable Markdown brief plus browser print/PDF support so users can keep both evidence and presentation formats.

## Product

- Upload a compatible customer CSV and inspect dimensions, preview rows, inferred types, and target detection.
- Review missing cells, duplicates, invalid values, outliers, category inconsistencies, and cardinality findings.
- Explore churn KPIs, category breakdowns, distributions, correlations, tenure/charges relationships, risk segments, insights, recommendations, and transformation notes.
- Export chart data, a full Markdown analysis brief, or a print-ready PDF from the browser.

## User preferences

No additional user preferences recorded.

## Gotchas

- The shared API accepts up to 12 MB of JSON and caps analysis at 200 columns / 100,000 rows per upload.
- Auto-refresh is off by default and the shortest available interval is five minutes.
- Churn-specific findings require a column whose name or values clearly indicate a churn, attrition, exit, or cancellation outcome.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
