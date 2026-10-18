# StockSense AI architecture

## System boundaries

```text
Browser UI
  ├─ generated React Query hooks
  ├─ contextual product/operation links
  ├─ browser-native speech and barcode capabilities (optional)
  └─ explicit, client-only demo dataset (optional)
       ↓
Authenticated Express API
  ├─ Clerk session authentication
  ├─ per-user inventory authorization
  └─ PostgreSQL via Drizzle
       ↓
StockSense catalog, locations, operations, and append-only movement ledger
       ↓
Pure deterministic inventory-intelligence functions
       ↓
Structured signals → answer/brief → existing StockSense actions
```

The existing API and database remain the source of truth. The intelligence page consumes the generated API client; it does not write inventory data. Any stock change still follows the existing receipt, delivery, transfer, or adjustment workflow and its validation rules.

## Data flow

1. The signed-in user loads products, warehouses, operations, dashboard totals, and recorded stock moves through generated hooks.
2. The intelligence engine groups moves by product and applies the documented thresholds below.
3. Signals include the affected product, evidence, a plain-language reason, and a suggested review action.
4. The UI displays the signal source as deterministic inventory rules. It does not present a recommendation as a verified fact.
5. Product and operation actions navigate to existing detail/workflow routes.

The demo dataset is separate from API responses, visibly marked **DEMO DATA**, and never sent to the server.

## Intelligence rules

All date windows are evaluated against the current time. Invalid or future timestamps are ignored.

### Stockout review

- The API's existing `stockStatus` and current quantity determine whether a product is below its recorded reorder point or out of stock.
- A rough daily delivery rate uses absolute delivery quantities in the last 30 days.
- A days-of-cover estimate is shown only when there are at least three recorded deliveries spanning at least 14 days and the total recorded quantity is non-zero.
- Estimated cover is `current stock ÷ (30-day delivered units ÷ 30)`.
- Without that history, the UI explicitly says: “Not enough historical data for a reliable estimate.”

This is an estimate from recorded deliveries, not a forecast of future customer demand.

### Overstock review candidate

A candidate is shown only when all conditions hold:

- current stock is at least four times the recorded reorder point;
- there are at least three deliveries from 31–90 days ago; and
- there are no recorded deliveries in the last 30 days.

The alert is labeled a review signal. A reorder point is not a maximum-stock target, so this condition does not prove that inventory is excessive.

### Unusual movement

- Candidate moves occurred within the last 30 days.
- The baseline uses at least four earlier moves for the same product, from days 31–90.
- A move is flagged when its absolute quantity is at least three times the earlier median and at least two units above it.
- The alert links to the operation where an `operationId` is available.

An outlier means “different from this product's recorded pattern,” not fraud or an invalid operation.

### Inventory health estimate

The estimate appears only with at least three products and five recorded movements:

```text
score = max(0, round(
  100
  - 50 × out-of-stock product share
  - 25 × low-stock product share
  - 25 × unusual movement share
))
```

The UI shows the formula and says this is not a service-level or financial KPI. It is a transparent heuristic, not a learned score.

## Failure and data safety

- API loading and error states are independent; a failed query does not imply zero inventory.
- Demo mode does not write to the database.
- No schema or OpenAPI changes are required for this feature.
- Inventory ownership and authentication remain enforced by existing API middleware.
- No model request is sent when asking a question; answers are computed from the loaded records.