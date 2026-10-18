import type { Operation, Product, StockMove } from "@workspace/api-client-react";

export type IntelligenceProduct = Pick<
  Product,
  "id" | "name" | "sku" | "unit" | "reorderPoint" | "totalStock" | "stockStatus" | "locationStocks"
>;

export type IntelligenceMove = Pick<
  StockMove,
  "id" | "productId" | "type" | "quantity" | "movedAt" | "reference" | "operationId" | "sourceLocationName" | "destinationLocationName"
>;

export type IntelligenceOperation = Pick<
  Operation,
  "id" | "reference" | "type" | "status" | "contact" | "sourceLocationName" | "destinationLocationName" | "lines"
>;

export type IntelligenceLocationContext = {
  locationName: string;
  warehouseName?: string;
};

export type SignalKind = "stockout" | "overstock" | "unusual-movement";
export type SignalSeverity = "critical" | "high" | "watch";

export type InventorySignal = {
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  productId: number;
  productName: string;
  sku: string;
  stock: number;
  unit: string;
  location: string;
  occurredAt: string | null;
  operationId: number | null;
  reason: string;
  evidence: string[];
  recommendation: string;
};

export type ProductMovementSummary = {
  productId: number;
  outboundUnits30d: number;
  outboundOperations30d: number;
  estimatedDailyRate: number | null;
  estimatedDaysCover: number | null;
  hasReliableRate: boolean;
};

export type InventoryHealth = {
  score: number | null;
  available: boolean;
  breakdown: {
    outOfStockShare: number | null;
    lowStockShare: number | null;
    unusualMovementShare: number | null;
  };
  note: string;
};

export type InventoryIntelligence = {
  signals: InventorySignal[];
  stockoutSignals: InventorySignal[];
  overstockSignals: InventorySignal[];
  anomalySignals: InventorySignal[];
  movementByProduct: Record<number, ProductMovementSummary>;
  health: InventoryHealth;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  recentMoveCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STOCKOUT_WINDOW_DAYS = 30;
const ANOMALY_WINDOW_DAYS = 30;
const ANOMALY_BASELINE_DAYS = 90;

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageInDays(value: string | Date | null | undefined, nowMs: number): number | null {
  const time = timestamp(value);
  if (time === null || time > nowMs) return null;
  return (nowMs - time) / DAY_MS;
}

function quantityOf(move: IntelligenceMove): number {
  return Math.abs(numeric(move.quantity));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function locationFor(move: IntelligenceMove): string {
  return move.destinationLocationName ?? move.sourceLocationName ?? "Location not recorded";
}

function severityRank(severity: SignalSeverity): number {
  return severity === "critical" ? 0 : severity === "high" ? 1 : 2;
}

function makeStockoutSignal(
  product: IntelligenceProduct,
  movement: ProductMovementSummary,
): InventorySignal {
  const stock = numeric(product.totalStock);
  const reorderPoint = numeric(product.reorderPoint);
  const isOut = product.stockStatus === "out" || stock <= 0;
  const severity: SignalSeverity = isOut
    ? "critical"
    : movement.hasReliableRate && movement.estimatedDaysCover !== null && movement.estimatedDaysCover <= 7
      ? "high"
      : "watch";
  const evidence = [
    `Current stock: ${stock} ${product.unit}.`,
    `Recorded reorder point: ${reorderPoint} ${product.unit}.`,
    movement.hasReliableRate
      ? `Recorded deliveries in the last 30 days: ${movement.outboundUnits30d} ${product.unit} across ${movement.outboundOperations30d} operations.`
      : "Not enough historical data for a reliable movement-rate estimate.",
  ];

  if (movement.hasReliableRate && movement.estimatedDaysCover !== null) {
    evidence.push(`Estimated cover at the recorded 30-day delivery rate: ${movement.estimatedDaysCover.toFixed(1)} days.`);
  }

  return {
    id: `stockout-${product.id}`,
    kind: "stockout",
    severity,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    stock,
    unit: product.unit,
    location: product.locationStocks[0]?.locationName ?? "Location not recorded",
    occurredAt: null,
    operationId: null,
    reason: isOut
      ? "The catalog reports no stock on hand."
      : movement.hasReliableRate && movement.estimatedDaysCover !== null
        ? "Available stock is below the reorder point and recent recorded deliveries support a rough cover estimate."
        : "The catalog reports stock below its reorder point; the movement history is not sufficient for a reliable time estimate.",
    evidence,
    recommendation: isOut ? "Review replenishment before accepting new demand." : "Review replenishment and confirm the expected demand.",
  };
}

function calculateHealth(
  products: IntelligenceProduct[],
  moves: IntelligenceMove[],
  stockoutSignals: InventorySignal[],
  anomalySignals: InventorySignal[],
): InventoryHealth {
  if (products.length < 3 || moves.length < 5) {
    return {
      score: null,
      available: false,
      breakdown: {
        outOfStockShare: null,
        lowStockShare: null,
        unusualMovementShare: null,
      },
      note: "Not enough data for a reliable health estimate. At least 3 products and 5 recorded movements are required.",
    };
  }

  const productCount = products.length;
  const outCount = products.filter((product) => product.stockStatus === "out" || numeric(product.totalStock) <= 0).length;
  const lowCount = products.filter((product) => product.stockStatus === "low").length;
  const outOfStockShare = outCount / productCount;
  const lowStockShare = lowCount / productCount;
  const unusualMovementShare = Math.min(1, anomalySignals.length / moves.length);

  // The weights are visible, fixed rules rather than a learned or clinical score.
  const score = Math.max(0, Math.round(
    100
    - (outOfStockShare * 50)
    - (lowStockShare * 25)
    - (unusualMovementShare * 25),
  ));

  return {
    score,
    available: true,
    breakdown: { outOfStockShare, lowStockShare, unusualMovementShare },
    note: "Rule-based estimate: out-of-stock share × 50, low-stock share × 25, and unusual-movement share × 25 are subtracted from 100. This is not a service-level or financial KPI.",
  };
}

export function deriveInventoryIntelligence(
  products: IntelligenceProduct[],
  moves: IntelligenceMove[],
  now = new Date(),
): InventoryIntelligence {
  const nowMs = now.getTime();
  const productMoves = new Map<number, IntelligenceMove[]>();
  for (const move of moves) {
    const current = productMoves.get(move.productId) ?? [];
    current.push(move);
    productMoves.set(move.productId, current);
  }

  const movementByProduct: Record<number, ProductMovementSummary> = {};
  const stockoutSignals: InventorySignal[] = [];
  const overstockSignals: InventorySignal[] = [];
  const anomalySignals: InventorySignal[] = [];

  for (const product of products) {
    const allMoves = productMoves.get(product.id) ?? [];
    const deliveries30d = allMoves.filter((move) => {
      const age = ageInDays(move.movedAt, nowMs);
      return move.type === "delivery" && age !== null && age <= STOCKOUT_WINDOW_DAYS;
    });
    const deliveryAges = deliveries30d
      .map((move) => ageInDays(move.movedAt, nowMs))
      .filter((age): age is number => age !== null);
    const timeSpan = deliveryAges.length > 1
      ? Math.max(...deliveryAges) - Math.min(...deliveryAges)
      : 0;
    const outboundUnits30d = deliveries30d.reduce((sum, move) => sum + quantityOf(move), 0);
    const hasReliableRate = deliveries30d.length >= 3 && timeSpan >= 14 && outboundUnits30d > 0;
    const estimatedDailyRate = hasReliableRate ? outboundUnits30d / STOCKOUT_WINDOW_DAYS : null;
    const stock = numeric(product.totalStock);
    const movement: ProductMovementSummary = {
      productId: product.id,
      outboundUnits30d,
      outboundOperations30d: deliveries30d.length,
      estimatedDailyRate,
      estimatedDaysCover: estimatedDailyRate && stock >= 0 ? stock / estimatedDailyRate : null,
      hasReliableRate,
    };
    movementByProduct[product.id] = movement;

    if (product.stockStatus === "low" || product.stockStatus === "out" || stock <= 0) {
      stockoutSignals.push(makeStockoutSignal(product, movement));
    }

    const olderDeliveries = allMoves.filter((move) => {
      const age = ageInDays(move.movedAt, nowMs);
      return move.type === "delivery"
        && age !== null
        && age > 30
        && age <= 90;
    });
    const recentDeliveries = deliveries30d.length;
    const reorderPoint = numeric(product.reorderPoint);
    if (reorderPoint > 0 && stock >= reorderPoint * 4 && olderDeliveries.length >= 3 && recentDeliveries === 0) {
      overstockSignals.push({
        id: `overstock-${product.id}`,
        kind: "overstock",
        severity: "watch",
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        stock,
        unit: product.unit,
        location: product.locationStocks[0]?.locationName ?? "Location not recorded",
        occurredAt: null,
        operationId: null,
        reason: "Review signal only: stock is at least 4× the recorded reorder point, with no delivery recorded in 30 days after at least 3 deliveries in the prior 90-day window.",
        evidence: [
          `Current stock: ${stock} ${product.unit}.`,
          `Recorded reorder point: ${reorderPoint} ${product.unit}.`,
          `Recorded deliveries from 31–90 days ago: ${olderDeliveries.length}.`,
          "Recorded deliveries in the last 30 days: 0.",
        ],
        recommendation: "Review demand and storage levels before changing replenishment settings.",
      });
    }

    const recentCandidates = allMoves
      .filter((move) => {
        const age = ageInDays(move.movedAt, nowMs);
        return age !== null && age <= ANOMALY_WINDOW_DAYS;
      })
      .sort((a, b) => (timestamp(b.movedAt) ?? 0) - (timestamp(a.movedAt) ?? 0));
    const baseline = allMoves.filter((move) => {
      const age = ageInDays(move.movedAt, nowMs);
      return age !== null && age > ANOMALY_WINDOW_DAYS && age <= ANOMALY_BASELINE_DAYS;
    });
    if (baseline.length < 4) continue;

    const baselineMedian = median(baseline.map(quantityOf));
    if (baselineMedian === null || baselineMedian <= 0) continue;
    for (const move of recentCandidates) {
      const quantity = quantityOf(move);
      if (quantity < baselineMedian * 3 || quantity < baselineMedian + 2) continue;
      anomalySignals.push({
        id: `movement-${move.id}`,
        kind: "unusual-movement",
        severity: "high",
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        stock,
        unit: product.unit,
        location: locationFor(move),
        occurredAt: move.movedAt,
        operationId: move.operationId,
        reason: `This ${move.type} movement is at least 3× the median size of ${baseline.length} earlier ledger entries for this product.`,
        evidence: [
          `Recorded movement: ${quantity} ${product.unit} (${move.type}).`,
          `Earlier movement median: ${baselineMedian} ${product.unit}.`,
          `Reference: ${move.reference || "No reference recorded"}.`,
        ],
        recommendation: "Review the recorded operation and confirm the quantity and location.",
      });
    }
  }

  const signals = [...stockoutSignals, ...overstockSignals, ...anomalySignals]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
      || (timestamp(b.occurredAt) ?? 0) - (timestamp(a.occurredAt) ?? 0)
      || a.productName.localeCompare(b.productName));
  const outOfStockCount = products.filter((product) => product.stockStatus === "out" || numeric(product.totalStock) <= 0).length;
  const lowStockCount = products.filter((product) => product.stockStatus === "low").length;
  const cutoff = nowMs - STOCKOUT_WINDOW_DAYS * DAY_MS;
  const recentMoveCount = moves.filter((move) => {
    const time = timestamp(move.movedAt);
    return time !== null && time >= cutoff && time <= nowMs;
  }).length;

  return {
    signals,
    stockoutSignals,
    overstockSignals,
    anomalySignals,
    movementByProduct,
    health: calculateHealth(products, moves, stockoutSignals, anomalySignals),
    totalUnits: products.reduce((sum, product) => sum + numeric(product.totalStock), 0),
    lowStockCount,
    outOfStockCount,
    recentMoveCount,
  };
}

export type InventoryAnswer = {
  answer: string;
  why: string;
  evidence: string[];
  action: string;
  providerLabel: "Deterministic inventory rules";
  productId?: number;
  operationId?: number;
  locationName?: string;
};

export function answerInventoryQuestion(
  question: string,
  products: IntelligenceProduct[],
  intelligence: InventoryIntelligence,
  contextProductId?: number,
): InventoryAnswer {
  const normalized = question.trim().toLowerCase();
  if (/\btoday\b|\byesterday\b|\bthis week\b/.test(normalized)) {
    return {
      answer: "This helper cannot answer date-specific activity questions yet.",
      why: "Its movement comparisons use a 30-day window, not the requested day or week.",
      evidence: [`Recorded movements in the last 30 days: ${intelligence.recentMoveCount}.`],
      action: "Open the movement ledger to review exact dates, or ask about unusual movements.",
      providerLabel: "Deterministic inventory rules",
    };
  }
  const product = contextProductId
    ? products.find((item) => item.id === contextProductId)
    : undefined;

  if (product) {
    const matching = intelligence.signals.filter((signal) => signal.productId === product.id);
    const movement = intelligence.movementByProduct[product.id];
    const primary = matching[0];
    return {
      answer: primary
        ? `${product.name} needs review: ${primary.kind === "stockout" ? "stock is below its recorded reorder point" : primary.kind === "overstock" ? "a stock-level review signal is present" : "a movement is outside its recent recorded pattern"}.`
        : `${product.name} is ${product.stockStatus} with ${numeric(product.totalStock)} ${product.unit} on hand.`,
      why: primary?.reason ?? "No current deterministic risk signal was found for this product.",
      evidence: [
        `SKU: ${product.sku}.`,
        `Current stock: ${numeric(product.totalStock)} ${product.unit}.`,
        `Recorded reorder point: ${numeric(product.reorderPoint)} ${product.unit}.`,
        movement?.hasReliableRate
          ? `Recorded delivery rate: ${movement.estimatedDailyRate?.toFixed(2)} ${product.unit}/day over the last 30 days.`
          : "Not enough historical data for a reliable movement-rate estimate.",
        ...matching.flatMap((signal) => [signal.reason, ...signal.evidence]),
      ],
      action: primary?.recommendation ?? "Continue monitoring recorded stock and movements.",
      providerLabel: "Deterministic inventory rules",
      productId: product.id,
    };
  }

  if (/overstock|too much|excess|slow/.test(normalized)) {
    const signal = intelligence.overstockSignals[0];
    return {
      answer: signal
        ? `${signal.productName} is the strongest overstock review candidate in the recorded data.`
        : "No overstock review candidate meets the current evidence rules.",
      why: signal?.reason ?? "The rule requires stock at least 4× the reorder point, prior activity, and no recorded delivery in the last 30 days.",
      evidence: signal?.evidence ?? [
        `Products checked: ${products.length}.`,
        "No product met all of the overstock review conditions.",
      ],
      action: signal?.recommendation ?? "Review reorder points and recorded activity if you expect more demand.",
      providerLabel: "Deterministic inventory rules",
    };
  }

  if (/unusual|anomal|movement/.test(normalized)) {
    const signal = intelligence.anomalySignals[0];
    return {
      answer: signal
        ? `${signal.productName} has a recorded movement that is at least 3× its earlier median.`
        : "No unusual movement met the current comparison rule.",
      why: signal?.reason ?? "Movement alerts require at least 4 earlier ledger entries for the same product.",
      evidence: signal?.evidence ?? [
        `Movements checked: ${intelligence.recentMoveCount} in the last 30 days.`,
        "No qualifying outlier was found in the available records.",
      ],
      action: signal?.recommendation ?? "Continue reviewing the movement ledger as new activity is recorded.",
      providerLabel: "Deterministic inventory rules",
    };
  }

  if (!/attention|risk|stock|reorder|replenish|review|summary|brief/.test(normalized)) {
    return {
      answer: "This question is outside the supported inventory rules.",
      why: "This is a rule-based helper, not a general-purpose AI model.",
      evidence: ["Supported questions cover stock risks, overstock, unusual movements, and selected products, operations, or locations."],
      action: "Ask “What needs attention?”, “Which products are overstocked?”, or “Are there unusual movements?”",
      providerLabel: "Deterministic inventory rules",
    };
  }
  const primary = intelligence.signals[0];
  const attentionProducts = new Set(intelligence.signals.map((signal) => signal.productId)).size;
  return {
    answer: primary
      ? `${attentionProducts} ${attentionProducts === 1 ? "product needs" : "products need"} attention. Start with ${primary.productName}.`
      : "No current stock-risk or unusual-movement signals were found in the available data.",
    why: primary?.reason ?? "The current inventory rules did not find a qualifying signal.",
    evidence: primary
      ? primary.evidence
      : [
          `Products checked: ${products.length}.`,
          `Recorded movements in the last 30 days: ${intelligence.recentMoveCount}.`,
        ],
    action: primary?.recommendation ?? "Continue normal monitoring and record movements as they occur.",
    providerLabel: "Deterministic inventory rules",
  };
}

export function explainInventoryOperation(operation: IntelligenceOperation): InventoryAnswer {
  const totalUnits = operation.lines.reduce((sum, line) => sum + Math.abs(numeric(line.quantity)), 0);
  const productCount = new Set(operation.lines.map((line) => line.productId)).size;
  const route = [operation.sourceLocationName, operation.destinationLocationName]
    .filter((location): location is string => Boolean(location))
    .join(" → ");

  return {
    answer: `${operation.type} ${operation.reference} is recorded as ${operation.status}.`,
    why: "This summary uses the saved operation fields; it does not independently confirm that a physical movement was completed.",
    evidence: [
      `Reference: ${operation.reference}.`,
      `Status: ${operation.status}.`,
      `${operation.lines.length} line items across ${productCount} products; ${totalUnits} total units recorded.`,
      ...(route ? [`Recorded route: ${route}.`] : []),
      ...(operation.contact ? [`Contact: ${operation.contact}.`] : []),
      ...operation.lines.slice(0, 5).map((line) => `${line.productName} (${line.sku}): ${numeric(line.quantity)} ${line.unit}.`),
      ...(operation.lines.length > 5 ? [`${operation.lines.length - 5} additional line items are in the operation record.`] : []),
    ],
    action: "Open the operation record to review its status, route, and line items.",
    providerLabel: "Deterministic inventory rules",
    operationId: operation.id,
  };
}

export function analyzeInventoryLocation(
  context: IntelligenceLocationContext,
  products: IntelligenceProduct[],
  moves: IntelligenceMove[],
): InventoryAnswer {
  const locationName = context.locationName.trim();
  const warehouseName = context.warehouseName?.trim();
  const matchingStocks = products.flatMap((product) =>
    product.locationStocks
      .filter((stock) =>
        stock.locationName.toLowerCase() === locationName.toLowerCase()
        && (!warehouseName || stock.warehouseName.toLowerCase() === warehouseName.toLowerCase()),
      )
      .map((stock) => ({ product, quantity: numeric(stock.quantity) })),
  );
  const productIds = new Set(matchingStocks.map(({ product }) => product.id));
  const totalUnits = matchingStocks.reduce((sum, stock) => sum + stock.quantity, 0);
  const atRiskProducts = [...new Map(matchingStocks
    .filter(({ product }) => product.stockStatus === "low" || product.stockStatus === "out" || numeric(product.totalStock) <= 0)
    .map(({ product }) => [product.id, product])).values()];
  const recentMoveCount = moves.filter((move) => {
    const age = ageInDays(move.movedAt, Date.now());
    const touchesLocation = [move.sourceLocationName, move.destinationLocationName]
      .some((name) => name?.toLowerCase() === locationName.toLowerCase());
    return touchesLocation && age !== null && age <= STOCKOUT_WINDOW_DAYS;
  }).length;
  const label = warehouseName ? `${warehouseName} · ${locationName}` : locationName;

  return {
    answer: matchingStocks.length
      ? `${label} has ${totalUnits} recorded units across ${productIds.size} products.`
      : `No product stock is currently recorded at ${label}.`,
    why: "This is a summary of saved location-stock and movement records; it does not verify a physical count.",
    evidence: [
      `Products with stock recorded here: ${productIds.size}.`,
      `Total units recorded here: ${totalUnits}.`,
      `Movements matching this location name in the last 30 days: ${recentMoveCount}${warehouseName ? " (across warehouses; the ledger does not identify warehouses)" : ""}.`,
      atRiskProducts.length
        ? `Products at a catalog-level stock warning with stock here: ${atRiskProducts.map((product) => product.name).join(", ")}.`
        : "No catalog-level low or out-of-stock warning was found among products recorded here.",
    ],
    action: "Confirm the shelf quantity against the physical count before moving or reordering stock.",
    providerLabel: "Deterministic inventory rules",
    locationName,
  };
}

export function generateDailyInventoryBrief(
  products: IntelligenceProduct[],
  intelligence: InventoryIntelligence,
): string {
  const attentionProducts = new Set(intelligence.signals.map((signal) => signal.productId)).size;
  const lines = [
    `Inventory summary: ${products.length} products, ${intelligence.totalUnits} units on hand.`,
    `${attentionProducts} products have a current rule-based review signal.`,
  ];
  const firstSignals = intelligence.signals.slice(0, 3);
  for (const signal of firstSignals) {
    lines.push(`${signal.productName}: ${signal.reason} Recommended: ${signal.recommendation}`);
  }
  if (!firstSignals.length) {
    lines.push("No current stock-risk or unusual-movement signals were found in the available records.");
  }
  lines.push("Recommendations are based on the available inventory records; they are not confirmed forecasts.");
  return lines.join(" ");
}

export function generateInventoryReport(
  products: IntelligenceProduct[],
  intelligence: InventoryIntelligence,
): string {
  const section = (title: string, signals: InventorySignal[]) => [
    title,
    ...signals.map((signal) => `- ${signal.productName} / ${signal.sku}: ${signal.reason}\n  Evidence: ${signal.evidence.join(" ")}\n  Recommended action: ${signal.recommendation}`),
    ...(signals.length ? [] : ["- No qualifying signals in the available records."]),
  ].join("\n");
  return [
    "Inventory summary",
    generateDailyInventoryBrief(products, intelligence),
    `Low-stock products: ${intelligence.lowStockCount}. Out-of-stock products: ${intelligence.outOfStockCount}.`,
    `Recorded movements in the last 30 days: ${intelligence.recentMoveCount}.`,
    section("Stock risks", intelligence.stockoutSignals),
    section("Overstock review", intelligence.overstockSignals),
    section("Unusual activity", intelligence.anomalySignals),
    "Recommended actions\n" + (intelligence.signals.map((signal) => `- ${signal.productName}: ${signal.recommendation}`).join("\n") || "- Continue monitoring and recording inventory movements."),
    `Health estimate: ${intelligence.health.available ? `${intelligence.health.score}/100` : "Unavailable"}.\n${intelligence.health.note}`,
    "Scope: current catalog and available movement records. Deterministic rules, not confirmed forecasts or live local AI.",
  ].join("\n\n");
}