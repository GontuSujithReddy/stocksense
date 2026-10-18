import { and, eq, inArray } from "drizzle-orm";
import { currencyDigits } from "./pricing";
import {
  db,
  categories,
  products,
  warehouses,
  locations,
  balances,
  operations,
  operationLines,
  stockMoves,
  deliveryProfiles,
  deliveryConfirmations,
} from "@workspace/db";

export async function enrichedProducts(ownerId: string, warehouseId?: number) {
  const [productRows, categoryRows, balanceRows, locationRows, warehouseRows] = await Promise.all([
    db.select().from(products).where(eq(products.ownerId, ownerId)),
    db.select().from(categories).where(eq(categories.ownerId, ownerId)),
    db.select().from(balances).where(eq(balances.ownerId, ownerId)),
    db.select().from(locations).where(eq(locations.ownerId, ownerId)),
    db.select().from(warehouses).where(eq(warehouses.ownerId, ownerId)),
  ]);
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const locationById = new Map(locationRows.map((location) => [location.id, location]));
  const warehouseById = new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse]));

  return productRows
    .filter((product) => product.active)
    .map((product) => {
      const locationStocks = balanceRows
        .filter((balance) => balance.productId === product.id)
        .flatMap((balance) => {
          const location = locationById.get(balance.locationId);
          if (!location || (warehouseId && location.warehouseId !== warehouseId)) return [];
          const warehouse = warehouseById.get(location.warehouseId);
          if (!warehouse) return [];
          return [{
            locationId: location.id,
            locationName: location.name,
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            quantity: balance.quantity,
          }];
        });
      const totalStock = locationStocks.reduce((sum, stock) => sum + stock.quantity, 0);
      const stockStatus = totalStock <= 0
        ? "out" as const
        : totalStock <= product.reorderPoint
          ? "low" as const
          : "healthy" as const;
      const defaultLocation = product.defaultLocationId
        ? locationById.get(product.defaultLocationId)
        : undefined;
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        categoryId: product.categoryId,
        categoryName: product.categoryId ? categoryById.get(product.categoryId)?.name ?? null : null,
        imageAssetId: product.imageAssetId,
        imageFit: product.imageFit,
        defaultLocationId: product.defaultLocationId,
        defaultLocationName: product.defaultLocationId
          ? defaultLocation?.name ?? null
          : null,
        defaultWarehouseName: product.defaultLocationId
          ? defaultLocation ? warehouseById.get(defaultLocation.warehouseId)?.name ?? null : null
          : null,
        unit: product.unit,
        reorderPoint: product.reorderPoint,
        sellingPriceUsd: product.sellingPriceCurrency !== "USD" ? null
          : product.sellingPriceMinor !== null ? product.sellingPriceMinor / 100
          : product.sellingPriceCents === null ? null : product.sellingPriceCents / 100,
        sellingPrice: product.sellingPriceMinor !== null
          ? product.sellingPriceMinor / (10 ** currencyDigits(product.sellingPriceCurrency))
          : product.sellingPriceCents === null ? null : product.sellingPriceCents / 100,
        currencyCode: product.sellingPriceCurrency,
        totalStock,
        stockStatus,
        locationStocks,
        createdAt: product.createdAt.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function enrichedOperations(ownerId: string) {
  const [operationRows, lineRows, productRows, locationRows, confirmationRows] = await Promise.all([
    db.select().from(operations).where(eq(operations.ownerId, ownerId)),
    db.select().from(operationLines).where(eq(operationLines.ownerId, ownerId)),
    db.select().from(products).where(eq(products.ownerId, ownerId)),
    db.select().from(locations).where(eq(locations.ownerId, ownerId)),
    db.select({
      operationId: deliveryConfirmations.operationId,
      customerPhone: deliveryConfirmations.customerPhone,
      deliveryAddress: deliveryConfirmations.deliveryAddress,
    }).from(deliveryConfirmations).where(eq(deliveryConfirmations.ownerId, ownerId)),
  ]);
  const productById = new Map(productRows.map((product) => [product.id, product]));
  const locationById = new Map(locationRows.map((location) => [location.id, location]));
  const confirmationByOperationId = new Map(confirmationRows.map((confirmation) => [confirmation.operationId, confirmation]));

  const courierIds = [...new Set(operationRows
    .filter(operation => operation.type === "delivery")
    .map(operation => operation.courierUserId)
    .filter((id): id is string => !!id))];
  const courierRows = courierIds.length ? await db.select({
    userId: deliveryProfiles.userId, name: deliveryProfiles.name, phone: deliveryProfiles.phone,
  }).from(deliveryProfiles).where(and(
    inArray(deliveryProfiles.userId, courierIds), eq(deliveryProfiles.role, "courier"),
  )) : [];
  const courierById = new Map(courierRows.map(courier => [courier.userId, courier]));

  return operationRows
    .map((operation) => ({
      id: operation.id,
      reference: operation.reference,
      type: operation.type as "receipt" | "delivery" | "transfer" | "adjustment",
      origin: operation.origin as "inventory" | "storefront",
      status: operation.status as "draft" | "waiting" | "ready" | "done" | "canceled",
      contact: operation.contact,
      customerEmail: operation.customerEmail,
      contactPhone: confirmationByOperationId.get(operation.id)?.customerPhone.trim() || null,
      deliveryAddress: confirmationByOperationId.get(operation.id)?.deliveryAddress.trim() || null,
      sourceLocationId: operation.sourceLocationId,
      sourceLocationName: operation.sourceLocationId
        ? locationById.get(operation.sourceLocationId)?.name ?? null
        : null,
      destinationLocationId: operation.destinationLocationId,
      destinationLocationName: operation.destinationLocationId
        ? locationById.get(operation.destinationLocationId)?.name ?? null
        : null,
      scheduledAt: operation.scheduledAt?.toISOString() ?? null,
      courierEmail: operation.courierEmail,
      courierName: operation.courierUserId ? courierById.get(operation.courierUserId)?.name ?? null : null,
      courierPhone: operation.courierUserId ? courierById.get(operation.courierUserId)?.phone ?? null : null,
      deliveryStartedAt: operation.deliveryStartedAt?.toISOString() ?? null,
      deliveryReachedAt: operation.deliveryReachedAt?.toISOString() ?? null,
      deliveryCompletedAt: operation.deliveryCompletedAt?.toISOString() ?? null,
      createdAt: operation.createdAt.toISOString(),
      lines: lineRows
        .filter((line) => line.operationId === operation.id)
        .map((line) => {
          const product = productById.get(line.productId);
          return {
            id: line.id,
            productId: line.productId,
            productName: product?.name ?? "Archived product",
            sku: product?.sku ?? "",
            unit: product?.unit ?? "units",
            quantity: line.quantity,
            countedQuantity: line.countedQuantity,
          };
        }),
    }))
    .sort((a, b) => b.id - a.id);
}

export async function enrichedMoves(ownerId: string) {
  const [moveRows, productRows, locationRows, warehouseRows, balanceRows] = await Promise.all([
    db.select().from(stockMoves).where(eq(stockMoves.ownerId, ownerId)),
    db.select().from(products).where(eq(products.ownerId, ownerId)),
    db.select().from(locations).where(eq(locations.ownerId, ownerId)),
    db.select().from(warehouses).where(eq(warehouses.ownerId, ownerId)),
    db.select().from(balances).where(eq(balances.ownerId, ownerId)),
  ]);
  const productById = new Map(productRows.map((product) => [product.id, product]));
  const locationById = new Map(locationRows.map((location) => [location.id, location]));
  const warehouseById = new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse]));
  const runningBalanceByKey = new Map(
    balanceRows.map(balance => [`${balance.productId}:${balance.locationId}`, balance.quantity]),
  );
  const stockEffectsByMoveId = new Map<number, {
    locationId: number;
    locationName: string;
    warehouseName: string;
    side: "source" | "destination";
    quantityBefore: number;
    quantityAdded: number;
    quantityRemoved: number;
    quantityRemaining: number;
  }[]>();

  const reverseChronologicalMoves = [...moveRows].sort((a, b) =>
    b.movedAt.getTime() - a.movedAt.getTime() || b.id - a.id,
  );
  for (const move of reverseChronologicalMoves) {
    const amount = Math.abs(move.quantity);
    const deltas: { locationId: number; side: "source" | "destination"; delta: number }[] = [];
    if (move.type === "receipt" && move.destinationLocationId !== null) {
      deltas.push({ locationId: move.destinationLocationId, side: "destination", delta: amount });
    } else if (move.type === "delivery" && move.sourceLocationId !== null) {
      deltas.push({ locationId: move.sourceLocationId, side: "source", delta: -amount });
    } else if (move.type === "transfer") {
      if (move.sourceLocationId !== null) {
        deltas.push({ locationId: move.sourceLocationId, side: "source", delta: -amount });
      }
      if (move.destinationLocationId !== null) {
        deltas.push({ locationId: move.destinationLocationId, side: "destination", delta: amount });
      }
    } else if (move.type === "adjustment") {
      if (move.sourceLocationId !== null) {
        deltas.push({ locationId: move.sourceLocationId, side: "source", delta: -amount });
      }
      if (move.destinationLocationId !== null) {
        deltas.push({ locationId: move.destinationLocationId, side: "destination", delta: amount });
      }
    }

    const effects = deltas.map(({ locationId, side, delta }) => {
      const key = `${move.productId}:${locationId}`;
      const quantityRemaining = runningBalanceByKey.get(key) ?? 0;
      const quantityBefore = quantityRemaining - delta;
      runningBalanceByKey.set(key, quantityBefore);
      const location = locationById.get(locationId);
      const warehouse = location ? warehouseById.get(location.warehouseId) : undefined;
      return {
        locationId,
        locationName: location?.name ?? "Unknown location",
        warehouseName: warehouse?.name ?? "Unknown warehouse",
        side,
        quantityBefore,
        quantityAdded: Math.max(delta, 0),
        quantityRemoved: Math.max(-delta, 0),
        quantityRemaining,
      };
    });
    stockEffectsByMoveId.set(move.id, effects);
  }

  return moveRows
    .map((move) => ({
      id: move.id,
      productId: move.productId,
      productName: productById.get(move.productId)?.name ?? "Archived product",
      productActive: productById.get(move.productId)?.active ?? false,
      sku: productById.get(move.productId)?.sku ?? "",
      type: move.type as "receipt" | "delivery" | "transfer" | "adjustment",
      operationId: move.operationId,
      reference: move.reference,
      sourceLocationName: move.sourceLocationId
        ? locationById.get(move.sourceLocationId)?.name ?? null
        : null,
      destinationLocationName: move.destinationLocationId
        ? locationById.get(move.destinationLocationId)?.name ?? null
        : null,
      sourceLocationId: move.sourceLocationId,
      destinationLocationId: move.destinationLocationId,
      quantity: move.quantity,
      stockEffects: stockEffectsByMoveId.get(move.id) ?? [],
      movedAt: move.movedAt.toISOString(),
    }))
    .sort((a, b) => Date.parse(b.movedAt) - Date.parse(a.movedAt) || b.id - a.id);
}