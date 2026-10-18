# StockSense

**Clear inventory signals. Confident next steps.**

StockSense is an inventory management experience that brings product, location, and movement data together with transparent signals for operators. It helps teams prioritize stock reviews while keeping existing inventory records and workflows as the source of truth.

## What it includes

- **Inventory command center** with review signals based on the signed-in user's inventory.
- **Stockout and overstock review** grounded in recorded quantities, reorder points, and movement history.
- **Unusual movement indicators** that highlight entries worth checking without presenting them as confirmed errors or fraud.
- **Contextual inventory answers** with evidence and practical follow-up actions.
- **Reports and search** for loaded inventory records.
- **Existing inventory workflows** for products, locations, receipts, deliveries, transfers, adjustments, and movement history.
- **Browser voice and barcode features** where supported by the device and browser.

## Architecture

- **Web client:** React, Vite, TypeScript
- **API:** Express, TypeScript, OpenAPI-generated request and response types
- **Data:** PostgreSQL with Drizzle ORM
- **Authentication:** Clerk
- **Workspace packages:** shared API schemas, client hooks, and database modules

The inventory signals are calculated from available application records. They do not replace the underlying inventory ledger or assert certainty beyond the data.

## Run locally

### Requirements

- Node.js 24
- pnpm
- PostgreSQL
- A configured Clerk application

### Install

```bash
pnpm install
```

Provide the configuration listed below through your shell or secret manager before starting either service. The API does not automatically load a .env file. Never commit credentials.

### Start the API and web client

Run each command in a separate terminal:

```bash
PORT=3001 pnpm --filter @workspace/api-server run dev
```

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/stocksense run dev
```

The web client calls the API through the same origin. Configure a local reverse proxy to route /api requests to port 3001 and web requests to port 5173 (and the Clerk proxy path if enabled). Starting both processes alone does not configure this routing. On Replit, use the managed same-origin service routing.

For a fresh development database only, review the schema and then run:

```bash
pnpm --filter @workspace/db run push
```

Do not run schema changes against a production database without reviewing their effect.

## Configuration

The API requires `DATABASE_URL`, `CLERK_SECRET_KEY`, and `SESSION_SECRET`. The web client requires `VITE_CLERK_PUBLISHABLE_KEY`; the API may also use `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PROXY_URL` depending on the authentication setup.

Optional capabilities may require their own server-side configuration, including Google Maps, Hindsight memory, and object storage. Configure those values in the development environment or secret manager. No credential values are included in this repository.

## Checks

```bash
pnpm run typecheck
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [AI and provider boundaries](docs/AI.md)
- [Development setup](docs/SETUP.md)
- [Phone-first experience](docs/PHONE_FIRST.md)
- [Demo guide](docs/DEMO.md)
