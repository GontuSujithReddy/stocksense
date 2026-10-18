import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, locations } from "@workspace/db";
import {
  GetDashboardQueryParams,
  GetDashboardResponse,
  ListMovesQueryParams,
  ListMovesResponse,
} from "@workspace/api-zod";
import {
  enrichedMoves,
  enrichedOperations,
  enrichedProducts,
} from "../lib/inventory-queries";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const { warehouseId, categoryId, type, status } = parsed.data;
  const [allProducts, allOperations, allMoves, locationRows] = await Promise.all([
    enrichedProducts(ownerId, warehouseId),
    enrichedOperations(ownerId),
    enrichedMoves(ownerId),
    db.select({ id: locations.id, warehouseId: locations.warehouseId }).from(locations).where(eq(locations.ownerId, ownerId)),
  ]);
  const filteredProducts = allProducts.filter((product) => categoryId == null || product.categoryId === categoryId);
  const filteredProductIds = new Set(filteredProducts.map((product) => product.id));
  const scopedLocationIds = new Set(locationRows.filter((location) => location.warehouseId === warehouseId).map((location) => location.id));
  const operationMatches = (operation: (typeof allOperations)[number]) =>
    (!warehouseId || (operation.sourceLocationId != null && scopedLocationIds.has(operation.sourceLocationId)) ||
      (operation.destinationLocationId != null && scopedLocationIds.has(operation.destinationLocationId))) &&
    (!categoryId || operation.lines.some((line) => filteredProductIds.has(line.productId))) &&
    (!type || operation.type === type) &&
    (!status || operation.status === status);
  const filteredOperations = allOperations.filter(operationMatches);
  const recentMoves = allMoves.filter((move) =>
    (!type || move.type === type) &&
    (!status || status === "done") &&
    (!categoryId || filteredProductIds.has(move.productId)) &&
    (!warehouseId || (move.sourceLocationId != null && scopedLocationIds.has(move.sourceLocationId)) ||
      (move.destinationLocationId != null && scopedLocationIds.has(move.destinationLocationId))),
  ).slice(0, 7);

  const categoryGroups = new Map<string, { categoryId: number | null; categoryName: string; quantity: number }>();
  for (const product of filteredProducts) {
    const key = String(product.categoryId ?? "uncategorized");
    const existing = categoryGroups.get(key);
    if (existing) existing.quantity += product.totalStock;
    else categoryGroups.set(key, {
      categoryId: product.categoryId,
      categoryName: product.categoryName ?? "Uncategorized",
      quantity: product.totalStock,
    });
  }

  res.json(GetDashboardResponse.parse({
    totalProducts: filteredProducts.length,
    totalUnits: filteredProducts.reduce((sum, product) => sum + product.totalStock, 0),
    lowStockItems: filteredProducts.filter((product) => product.stockStatus === "low").length,
    outOfStockItems: filteredProducts.filter((product) => product.stockStatus === "out").length,
    pendingReceipts: filteredOperations.filter((operation) => operation.type === "receipt" && !["done", "canceled"].includes(operation.status)).length,
    pendingDeliveries: filteredOperations.filter((operation) => operation.type === "delivery" && !["done", "canceled"].includes(operation.status)).length,
    scheduledTransfers: filteredOperations.filter((operation) => operation.type === "transfer" && !["done", "canceled"].includes(operation.status)).length,
    recentMoves,
    stockByCategory: [...categoryGroups.values()].sort((a, b) => b.quantity - a.quantity),
  }));
});

router.get("/moves", async (req, res): Promise<void> => {
  const parsed = ListMovesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const { search, warehouseId, productId, type } = parsed.data;
  const [moves, locationRows] = await Promise.all([
    enrichedMoves(ownerId),
    db.select({ id: locations.id, warehouseId: locations.warehouseId }).from(locations).where(eq(locations.ownerId, ownerId)),
  ]);
  const scopedLocationIds = new Set(locationRows.filter((location) => location.warehouseId === warehouseId).map((location) => location.id));
  const term = search?.trim().toLowerCase();
  res.json(ListMovesResponse.parse(moves.filter((move) =>
    (!term || move.productName.toLowerCase().includes(term) ||
      move.sku.toLowerCase().includes(term) ||
      move.reference.toLowerCase().includes(term)) &&
    (!warehouseId || (move.sourceLocationId != null && scopedLocationIds.has(move.sourceLocationId)) ||
      (move.destinationLocationId != null && scopedLocationIds.has(move.destinationLocationId))) &&
    (!productId || move.productId === productId) &&
    (!type || move.type === type),
  )));
});

export default router;