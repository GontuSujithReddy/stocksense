# StockSense AI demo — 3 to 5 minutes

Use the opt-in **DEMO DATA** mode for a repeatable presentation. Demo records are synthetic, client-only, and never saved to the signed-in user's inventory.

| Time | Presenter action | What to show |
| --- | --- | --- |
| 0:00–0:25 | Open StockSense on a phone and open Intelligence. Turn on **DEMO DATA**. | The command center immediately identifies three different review cases. Point out the demo label. |
| 0:25–1:05 | Open the low-stock item. | Current stock, reorder point, dated delivery history, estimated cover, and the evidence behind the estimate. Explain that the estimate appears only because the demo history passes the minimum threshold. |
| 1:05–1:35 | Ask “Why is this product at risk?” by voice if supported; otherwise type the same short question. | The answer is marked **Deterministic inventory rules** and presents answer, reason, evidence, and recommended action. |
| 1:35–2:10 | Show the SKU search or camera scanner. If camera scanning is supported, scan a label whose value matches a product SKU. | The scanner reads a barcode only when the browser supports it and permission is granted. If unsupported, use SKU search and show the honest fallback. |
| 2:10–2:50 | Open Inventory Radar and select the unusual-movement item. | The latest movement size compared with the earlier median, its reference/location/time, and the existing operation-review action. |
| 2:50–3:25 | Review the overstock candidate and location distribution. | The explicit rule: stock relative to reorder point, prior activity, and no recent delivery. Emphasize that this is a review candidate, not a certainty. |
| 3:25–4:05 | Generate the Daily Inventory Brief and select **Read Brief**. | Concise data-grounded summary and browser-native speech playback when available. |
| 4:05–4:40 | Export the report, then open the recommended product/operation workflow. | Phone-to-laptop handoff can use ordinary browser file sharing or device features. StockSense does not claim a direct Office Kit integration. |

## Demo checks

- Confirm the page says **DEMO DATA** before presenting any synthetic values.
- Do not claim a language model, NPU, offline speech recognizer, or Office Kit integration.
- If microphone/camera support is absent or denied, use the typed-query/SKU-search path.
- When using live inventory instead, confirm that each displayed product and movement exists in the signed-in workspace.
- The current demo data is illustrative; do not treat it as a benchmark or real prediction.