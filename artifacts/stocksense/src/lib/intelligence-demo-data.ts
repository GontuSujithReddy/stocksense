import type { Product, StockMove } from "@workspace/api-client-react";

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const location = (locationId: number, locationName: string, warehouseId: number, warehouseName: string, quantity: number) => ({
  locationId, locationName, warehouseId, warehouseName, quantity,
});

function product(id: number, name: string, sku: string, unit: string, reorderPoint: number, totalStock: number, stockStatus: Product["stockStatus"], locationStocks: Product["locationStocks"]): Product {
  return {
    id, name, sku, unit, reorderPoint, totalStock, stockStatus, locationStocks,
    categoryId: null, categoryName: null, imageAssetId: null, imageFit: { x: 0.5, y: 0.5, zoom: 1 }, defaultLocationId: locationStocks[0]?.locationId ?? null,
    defaultLocationName: locationStocks[0]?.locationName ?? null, defaultWarehouseName: locationStocks[0]?.warehouseName ?? null,
    sellingPrice: null, sellingPriceUsd: null, currencyCode: "USD", createdAt: daysAgo(180),
  };
}

const products: Product[] = [
  product(91001, "Thermal label rolls", "TLR-204", "rolls", 24, 12, "low", [location(901, "Pack bench", 90, "North dock", 8), location(902, "Reserve rack", 90, "North dock", 4)]),
  product(91002, "Pallet wrap · clear", "PWC-118", "rolls", 18, 96, "healthy", [location(903, "Bulk aisle", 90, "North dock", 72), location(904, "Overflow", 91, "South annex", 24)]),
  product(91003, "Nitrile gloves · M", "NGM-330", "boxes", 20, 44, "healthy", [location(905, "Safety cage", 91, "South annex", 44)]),
  product(91004, "Carton seal tape", "CST-052", "cases", 10, 52, "healthy", [location(906, "Pick face 04", 90, "North dock", 35), location(907, "Reserve rack", 90, "North dock", 17)]),
  product(91005, "Corner protectors", "CPR-770", "pieces", 8, 31, "healthy", [location(908, "Returns bay", 91, "South annex", 31)]),
];

const moves: StockMove[] = [
  ...[25, 18, 4].map((age, index) => ({
    id: 92001 + index, productId: 91001, productName: products[0].name, productActive: true, sku: products[0].sku,
    type: "delivery" as const, operationId: 93001 + index, reference: `DLV-204${index + 1}`, sourceLocationName: "Pack bench",
    destinationLocationName: "Customer dispatch", quantity: [14, 10, 12][index], stockEffects: [], movedAt: daysAgo(age),
  })),
  ...[42, 58, 77].map((age, index) => ({
    id: 92101 + index, productId: 91002, productName: products[1].name, productActive: true, sku: products[1].sku,
    type: "delivery" as const, operationId: 93101 + index, reference: `DLV-118${index + 1}`, sourceLocationName: "Bulk aisle",
    destinationLocationName: "Customer dispatch", quantity: 8 + index, stockEffects: [], movedAt: daysAgo(age),
  })),
  ...[
    { age: 75, quantity: 4 }, { age: 68, quantity: 5 }, { age: 60, quantity: 3 }, { age: 49, quantity: 4 },
    { age: 8, quantity: 36 },
  ].map((entry, index) => ({
    id: 92201 + index, productId: 91003, productName: products[2].name, productActive: true, sku: products[2].sku,
    type: "transfer" as const, operationId: 93201 + index, reference: `TRF-330${index + 1}`, sourceLocationName: "Safety cage",
    destinationLocationName: "Pick face 02", quantity: entry.quantity, stockEffects: [], movedAt: daysAgo(entry.age),
  })),
];

export const intelligenceDemoData = { products, moves };