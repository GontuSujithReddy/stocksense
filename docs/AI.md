# AI and provider boundary

## What runs today

The current StockSense intelligence experience uses deterministic rules, not a language model. The UI labels answers **Deterministic inventory rules**. It does not claim local inference, NPU usage, an open-source model, or an AI provider being connected.

The current implementation is useful without model access:

1. **Data:** signed-in user's catalog, stock totals, reorder points, locations, and movement history from the existing API.
2. **Business logic:** deterministic stockout, overstock-review, anomaly, and health calculations in `artifacts/stocksense/src/lib/inventory-intelligence.ts`.
3. **Structured signals:** severity, product, location, date/operation, evidence, reason, and suggested action.
4. **Answering:** the question helper selects from those real signals and returns a compact answer/why/evidence/action structure.
5. **Action:** the user opens the existing product or operation workflow to verify and act.

Basic arithmetic stays in application code. The question helper does not invent products, quantities, dates, locations, or movements. If the data is insufficient, it says so.

Unsupported questions receive an explicit limitation rather than an unrelated stock answer. Date-specific questions such as “What changed today?” are not yet supported; the movement rules use a 30-day window. The shift brief summarizes current risks, not an exact daily activity report.

Inventory report exports contain separate summary, stock-risk, overstock, unusual-activity, and recommended-action sections with evidence and the rules' limitations. Demo exports are explicitly labeled synthetic. A successfully scanned SKU opens the matched product's structured explanation; an unmatched scan does not invent a product.

Location-stock totals can be filtered by warehouse. Movement evidence can only match location names because the current movement response does not contain warehouse identifiers; when a warehouse is selected, the explanation explicitly warns that its movement count spans matching names across warehouses.

## Provider contract

The structured answer boundary is the integration point for a future provider. A model adapter should receive a bounded context containing the user's question, relevant real records, and already-computed signals; return a validated structured response; and preserve evidence identifiers. The deterministic implementation must remain available whenever a model is disabled or unavailable.

The adapter is not wired to an external service in this build. Connecting a local/open-source model later should not require changing inventory CRUD or the signal calculations. A future phone/NPU model must be installed and tested on the actual device before StockSense describes it as local or accelerated.

## Grounding and trust rules

- Treat API records and deterministic calculations as distinct from interpretation.
- Include the record or calculation behind each conclusion.
- Label recommendations as recommendations based on available inventory signals.
- Do not infer sales from stock movement unless the operation type explicitly supports that interpretation.
- Do not describe unusual activity as fraudulent.
- Do not invent a forecast when the history does not support one.
- Model output, if added later, must not replace server-side authorization or perform stock mutations.

## Voice and speech playback

Voice input uses browser-native speech-recognition APIs only when available and only after the user starts it. The transcript is sent to the same deterministic question helper as typed input. Browser/OS speech services may have their own connectivity behavior; StockSense does not claim the speech recognizer is offline.

Read Brief uses browser text-to-speech when available. It is a user-triggered playback feature, not model-generated audio.

## Future local/open-source adapter checklist

Before connecting an adapter:

1. Select and document a model and its license.
2. Confirm the actual runtime and device support; do not infer NPU support from a model name.
3. Minimize the context sent to inference and avoid cross-account data.
4. Validate structured output against a schema.
5. Preserve evidence references and deterministic fallback behavior.
6. Test unavailable, malformed-output, timeout, and permission-denied states.
7. Update this document to distinguish measured local execution from remote inference.