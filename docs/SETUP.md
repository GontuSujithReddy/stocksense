# Setup

## Requirements

- Node.js 24
- pnpm
- PostgreSQL
- Clerk configured for the development environment

## Install and run

From the workspace root:

```bash
pnpm install
PORT=3001 pnpm --filter @workspace/api-server run dev
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/stocksense run dev
```

In Replit, use the configured **API Server** and **StockSense web** workflows. The app expects the web and API services to be reachable through the same-origin proxy. For manual development, the API uses `PORT`; the web server uses `PORT` and `BASE_PATH`.

## Environment

Set values in the hosting environment's secret manager. Do not commit `.env` files or secret values.

Required for a working authenticated application:

- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `SESSION_SECRET`

Optional:

- `VITE_CLERK_PROXY_URL` for a configured Clerk proxy.
- Google Maps server/browser configuration for the existing place-search workflow; see [google-maps-setup.md](google-maps-setup.md).

The deterministic intelligence experience does not require a model API key.

## Database safety

For a new, empty development database only, inspect the schema and run:

```bash
pnpm --filter @workspace/db run push
```

This feature does not add tables or require a schema migration. Do not apply schema changes to an existing production database without first reviewing their effect.

## Type checking

```bash
pnpm run typecheck
```

The current work does not change `lib/api-spec/openapi.yaml`; OpenAPI code generation is not required.

## Browser notes
### Focused regression checks

With the workspace's Node 24 runtime, run:

```bash
node --test artifacts/api-server/src/lib/inventory-access.test.mjs artifacts/api-server/src/lib/delivery-support-auth.test.mjs artifacts/stocksense/src/lib/inventory-intelligence.test.mjs
```

These checks use isolated authorization dependencies and synthetic inventory records. They do not read customer data or call AI providers. The access suite checks both API prefixes, owner access, courier/staff restrictions, and empty courier lists. The intelligence suite checks history gating, unsupported questions, evidence, and report sections.


- Camera APIs require a secure context and user permission.
- Barcode scanning requires `BarcodeDetector`; not all browsers expose it.
- Voice input requires a browser speech-recognition implementation.
- Speech playback requires browser `speechSynthesis`.
- All three browser features have non-camera/non-microphone fallbacks.

## Source control hygiene

Upload source files and required public assets only. Do not upload `node_modules`, `dist`, `.env` files, database contents, secret keys, user screenshots, or local build artifacts.