import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./inventory-intelligence.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source);
const { deriveInventoryIntelligence, answerInventoryQuestion, generateInventoryReport } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const now = new Date("2026-10-02T12:00:00Z");
const product = { id: 1, name: "Test item", sku: "TEST-1", unit: "pieces", reorderPoint: 10, totalStock: 5, stockStatus: "low", locationStocks: [] };
const move = (id, days, quantity, type = "delivery") => ({ id, productId: 1, type, quantity, movedAt: new Date(now.getTime() - days * 86400000).toISOString(), reference: `TEST-${id}`, operationId: id, sourceLocationName: "Shelf", destinationLocationName: null });

test("delivery cover uses outbound history and excludes future and invalid dates", () => {
  const moves = [move(1, 1, -10), move(2, 15, -10), move(3, 29, -10), move(4, -1, -999), { ...move(5, 1, -999), movedAt: "invalid" }];
  const result = deriveInventoryIntelligence([product], moves, now);
  assert.equal(result.movementByProduct[1].outboundUnits30d, 30);
  assert.equal(result.movementByProduct[1].estimatedDaysCover, 5);
  assert.equal(result.recentMoveCount, 3);
});
test("insufficient history never invents a cover or health score", () => {
  const result = deriveInventoryIntelligence([product], [], now);
  assert.equal(result.movementByProduct[1].estimatedDaysCover, null);
  assert.equal(result.health.score, null);
});
test("unsupported and date-specific questions do not silently answer a different question", () => {
  const result = deriveInventoryIntelligence([product], [], now);
  assert.match(answerInventoryQuestion("What changed today?", [product], result).answer, /cannot answer date-specific/);
  assert.match(answerInventoryQuestion("What is tomorrow's profit?", [product], result).answer, /outside the supported/);
  assert.match(answerInventoryQuestion("What needs attention?", [product], result).answer, /Test item/);
});
test("product explanation includes all applicable evidence", () => {
  const moves = [move(1, 40, -2), move(2, 50, -2), move(3, 60, -2), move(4, 70, -2), move(5, 1, -20)];
  const result = deriveInventoryIntelligence([product], moves, now);
  assert.equal(result.signals.length, 2);
  const answer = answerInventoryQuestion("Explain", [product], result, 1);
  assert.ok(answer.evidence.some(item => item.includes("reorder point")));
  assert.ok(answer.evidence.some(item => item.includes("3×")));
});
test("report includes the required sections, actions, evidence, and truthful scope", () => {
  const result = deriveInventoryIntelligence([product], [], now);
  const report = generateInventoryReport([product], result);
  for (const heading of ["Inventory summary", "Stock risks", "Overstock review", "Unusual activity", "Recommended actions", "Evidence:", "Deterministic rules"]) assert.ok(report.includes(heading), heading);
  assert.match(report, /Review replenishment/);
});