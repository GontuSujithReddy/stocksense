import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  balances,
  categories,
  db,
  deliveryConfirmations,
  inventoryWorkspaces,
  locations,
  operationLines,
  operations,
  products,
  warehouses,
} from "@workspace/db";
import {
  CreatePublicStorefrontOrderBody,
  CreatePublicStorefrontOrderParams,
  CreatePublicStorefrontOrderResponse,
  GetPublicStorefrontParams,
  GetPublicStorefrontResponse,
  GetStorefrontSettingsResponse,
  UpdateStorefrontSettingsBody,
  UpdateStorefrontSettingsResponse,
} from "@workspace/api-zod";
import { currencyDigits } from "../lib/pricing";
import { InventoryError } from "../lib/inventory-error";

const publicRouter: IRouter = Router();
const settingsRouter: IRouter = Router();
const openStatuses = ["draft", "waiting", "ready"] as const;
const storefrontSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const orderRateWindowMs = 10 * 60 * 1000;
const orderRateLimit = 5;
const orderRequests = new Map<string, { count: number; resetAt: number }>();

function applyOrderRateLimit(res: Response, slug: string, customerEmail: string): boolean {
  const now = Date.now();
  if (orderRequests.size > 5000) {
    for (const [key, value] of orderRequests) {
      if (value.resetAt <= now) orderRequests.delete(key);
    }
  }
  const key = `${slug}:${customerEmail}`;
  const entry = orderRequests.get(key);
  if (!entry || entry.resetAt <= now) {
    orderRequests.set(key, { count: 1, resetAt: now + orderRateWindowMs });
    return true;
  }
  if (entry.count >= orderRateLimit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.status(429).json({ error: "Too many order attempts. Please try again in a few minutes." });
    return false;
  }
  entry.count += 1;
  return true;
}

function prettyStoreName(slug: string): string {
  return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function settingsForOwner(ownerId: string) {
  const [workspace, locationRows] = await Promise.all([
    db.select({
      slug: inventoryWorkspaces.storefrontSlug,
      fulfillmentLocationId: inventoryWorkspaces.storefrontLocationId,
    }).from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, ownerId)).limit(1),
    db.select({
      id: locations.id,
      name: locations.name,
      warehouseName: warehouses.name,
    }).from(locations).innerJoin(warehouses, and(
      eq(warehouses.id, locations.warehouseId),
      eq(warehouses.ownerId, ownerId),
    )).where(and(eq(locations.ownerId, ownerId), eq(locations.kind, "internal")))
      .orderBy(warehouses.name, locations.name),
  ]);
  return GetStorefrontSettingsResponse.parse({
    slug: workspace[0]?.slug ?? null,
    fulfillmentLocationId: workspace[0]?.fulfillmentLocationId ?? null,
    locations: locationRows,
  });
}

async function publicStorefrontContext(slug: string) {
  const [workspace] = await db.select({
    ownerId: inventoryWorkspaces.ownerId,
    locationId: inventoryWorkspaces.storefrontLocationId,
    deletedAt: inventoryWorkspaces.deletedAt,
    publishedDesign: inventoryWorkspaces.storefrontPublishedDesign,
  }).from(inventoryWorkspaces).where(eq(inventoryWorkspaces.storefrontSlug, slug)).limit(1);
  if (!workspace || workspace.deletedAt || !workspace.locationId) {
    throw new InventoryError("This storefront is not available.", 404);
  }
  const [location] = await db.select({
    id: locations.id,
  }).from(locations).where(and(
    eq(locations.id, workspace.locationId),
    eq(locations.ownerId, workspace.ownerId),
    eq(locations.kind, "internal"),
  )).limit(1);
  if (!location) throw new InventoryError("This storefront is not available.", 404);
  return {
    ownerId: workspace.ownerId,
    locationId: location.id,
    design: workspace.publishedDesign ?? {
      storeName: prettyStoreName(slug),
      tagline: "A local shop, ready to browse",
      description: "Browse what is available today and send a delivery request for the seller to review.",
      theme: "evergreen" as const,
      layout: "catalog" as const,
      heroImageAssetId: null,
      heroImageFit: { x: 0.5, y: 0.5, zoom: 1 },
    },
  };
}

settingsRouter.get("/storefront/settings", async (_req, res): Promise<void> => {
  res.json(await settingsForOwner(res.locals.ownerId as string));
});

settingsRouter.put("/storefront/settings", async (req, res): Promise<void> => {
  const parsed = UpdateStorefrontSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const { slug, fulfillmentLocationId } = parsed.data;
  if (slug !== null && !storefrontSlugPattern.test(slug)) {
    res.status(400).json({ error: "Use 3–40 lowercase letters, numbers, or hyphens for the storefront URL." });
    return;
  }
  if (slug !== null && fulfillmentLocationId === null) {
    res.status(400).json({ error: "Choose an internal stock location before publishing." });
    return;
  }
  if (fulfillmentLocationId !== null) {
    const [location] = await db.select({ id: locations.id }).from(locations).where(and(
      eq(locations.id, fulfillmentLocationId),
      eq(locations.ownerId, ownerId),
      eq(locations.kind, "internal"),
    )).limit(1);
    if (!location) throw new InventoryError("Choose an internal location in your workspace.", 400);
  }
  const [workspace] = await db.select({
    deletedAt: inventoryWorkspaces.deletedAt,
    storefrontCreatedAt: inventoryWorkspaces.storefrontCreatedAt,
  })
    .from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, ownerId)).limit(1);
  if (workspace?.deletedAt) throw new InventoryError("This inventory workspace is unavailable.", 403);

  let storefrontCreatedAt = workspace?.storefrontCreatedAt ?? null;
  if (slug !== null && !storefrontCreatedAt) {
    const [oldestRequest] = await db.select({
      createdAt: sql<Date | null>`min(${operations.createdAt})`,
    }).from(operations).where(and(
      eq(operations.ownerId, ownerId),
      eq(operations.origin, "storefront"),
    ));
    storefrontCreatedAt = oldestRequest?.createdAt ?? new Date();
  }

  try {
    await db.insert(inventoryWorkspaces).values({
      ownerId,
      storefrontSlug: slug,
      storefrontLocationId: fulfillmentLocationId,
      storefrontCreatedAt: slug === null ? null : storefrontCreatedAt,
    }).onConflictDoUpdate({
      target: inventoryWorkspaces.ownerId,
      set: {
        storefrontSlug: slug,
        storefrontLocationId: fulfillmentLocationId,
        ...(slug !== null ? { storefrontCreatedAt } : {}),
      },
    });
  } catch (error) {
    const databaseError = typeof error === "object" && error !== null && "cause" in error
      ? error.cause : error;
    if (typeof databaseError === "object" && databaseError !== null
      && "code" in databaseError && databaseError.code === "23505"
      && "constraint" in databaseError && databaseError.constraint === "inventory_workspaces_storefront_slug") {
      res.status(409).json({ error: "That storefront URL is already in use. Choose another." });
      return;
    }
    throw error;
  }
  res.json(await UpdateStorefrontSettingsResponse.parseAsync(await settingsForOwner(ownerId)));
});

publicRouter.get("/storefronts/:slug", async (req, res): Promise<void> => {
  const params = GetPublicStorefrontParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "This storefront is not available." });
    return;
  }
  const { ownerId, locationId, design } = await publicStorefrontContext(params.data.slug);
  const productRows = await db.select().from(products).where(and(
    eq(products.ownerId, ownerId),
    eq(products.active, true),
  )).orderBy(products.name);
  const productIds = productRows.map((product) => product.id);
  const [balanceRows, reservationRows, categoryRows] = productIds.length
    ? await Promise.all([
      db.select({ productId: balances.productId, quantity: balances.quantity }).from(balances)
        .where(and(
          eq(balances.ownerId, ownerId),
          eq(balances.locationId, locationId),
          inArray(balances.productId, productIds),
        )),
      db.select({
        productId: operationLines.productId,
        quantity: sql<number>`coalesce(sum(${operationLines.quantity}), 0)`,
      }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
        .where(and(
          eq(operationLines.ownerId, ownerId),
          eq(operations.ownerId, ownerId),
          eq(operations.origin, "storefront"),
          eq(operations.sourceLocationId, locationId),
          inArray(operations.status, [...openStatuses]),
          inArray(operationLines.productId, productIds),
        )).groupBy(operationLines.productId),
      db.select().from(categories).where(eq(categories.ownerId, ownerId)),
    ])
    : [[], [], []];
  const stockByProduct = new Map(balanceRows.map((row) => [row.productId, row.quantity]));
  const reservedByProduct = new Map(reservationRows.map((row) => [row.productId, Number(row.quantity)]));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const categoryCounts = new Map<number, number>();
  const publicProducts = productRows.map((product) => {
    const availableStock = Math.max(0, (stockByProduct.get(product.id) ?? 0) - (reservedByProduct.get(product.id) ?? 0));
    const category = product.categoryId === null ? undefined : categoryById.get(product.categoryId);
    if (category) categoryCounts.set(category.id, (categoryCounts.get(category.id) ?? 0) + 1);
    const sellingPrice = product.sellingPriceMinor !== null
      ? product.sellingPriceMinor / (10 ** currencyDigits(product.sellingPriceCurrency))
      : product.sellingPriceCents === null ? null : product.sellingPriceCents / 100;
    return {
      id: product.id,
      name: product.name,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      unit: product.unit,
      imageAssetId: product.imageAssetId,
      imageFit: product.imageFit,
      sellingPrice,
      currencyCode: product.sellingPriceCurrency,
      availableStock,
      stockStatus: availableStock <= 0 ? "out" as const
        : availableStock <= product.reorderPoint ? "low" as const : "healthy" as const,
    };
  });
  const categoryIds = new Set(publicProducts.map((product) => product.categoryId).filter((id): id is number => id !== null));
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(GetPublicStorefrontResponse.parse({
    slug: params.data.slug,
    storeName: design.storeName,
    design,
    categories: categoryRows.filter((category) => categoryIds.has(category.id)).map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      productCount: categoryCounts.get(category.id) ?? 0,
    })),
    products: publicProducts,
  }));
});

publicRouter.post("/storefronts/:slug/orders", async (req, res): Promise<void> => {
  const params = CreatePublicStorefrontOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "This storefront is not available." });
    return;
  }
  const parsed = CreatePublicStorefrontOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const customerName = input.customerName.trim();
  const customerEmail = input.customerEmail.trim().toLowerCase();
  const deliveryAddress = input.deliveryAddress.trim();
  if (!customerName || !deliveryAddress) {
    res.status(400).json({ error: "Add your name and full delivery address." });
    return;
  }
  if (!applyOrderRateLimit(res, params.data.slug, customerEmail)) return;
  if (input.lines.some((line) => Math.round(line.quantity * 1_000_000) / 1_000_000 !== line.quantity)) {
    res.status(400).json({ error: "Order quantities can include up to six decimal places." });
    return;
  }
  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length) {
    res.status(400).json({ error: "Add each product only once to your order." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [workspace] = await tx.select({
      ownerId: inventoryWorkspaces.ownerId,
      locationId: inventoryWorkspaces.storefrontLocationId,
      deletedAt: inventoryWorkspaces.deletedAt,
    }).from(inventoryWorkspaces).where(eq(inventoryWorkspaces.storefrontSlug, params.data.slug)).for("update");
    if (!workspace || workspace.deletedAt || !workspace.locationId) {
      throw new InventoryError("This storefront is not available.", 404);
    }
    const [location] = await tx.select({ id: locations.id }).from(locations).where(and(
      eq(locations.id, workspace.locationId),
      eq(locations.ownerId, workspace.ownerId),
      eq(locations.kind, "internal"),
    )).for("share");
    if (!location) throw new InventoryError("This storefront is not available.", 404);

    const orderedProductIds = [...productIds].sort((a, b) => a - b);
    const activeProducts = await tx.select({
      id: products.id,
      name: products.name,
      sellingPriceMinor: products.sellingPriceMinor,
      sellingPriceCents: products.sellingPriceCents,
      sellingPriceCurrency: products.sellingPriceCurrency,
    }).from(products).where(and(
      eq(products.ownerId, workspace.ownerId),
      eq(products.active, true),
      inArray(products.id, orderedProductIds),
    )).orderBy(products.id).for("update");
    if (activeProducts.length !== orderedProductIds.length) {
      throw new InventoryError("One or more items are no longer available. Refresh the storefront and try again.", 409);
    }

    const currentBalances = await tx.select({
      productId: balances.productId,
      quantity: balances.quantity,
    }).from(balances).where(and(
      eq(balances.ownerId, workspace.ownerId),
      eq(balances.locationId, location.id),
      inArray(balances.productId, orderedProductIds),
    )).for("update");
    const reservedRows = await tx.select({
      productId: operationLines.productId,
      quantity: sql<number>`coalesce(sum(${operationLines.quantity}), 0)`,
    }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
      .where(and(
        eq(operationLines.ownerId, workspace.ownerId),
        eq(operations.ownerId, workspace.ownerId),
        eq(operations.origin, "storefront"),
        eq(operations.sourceLocationId, location.id),
        inArray(operations.status, [...openStatuses]),
        inArray(operationLines.productId, orderedProductIds),
      )).groupBy(operationLines.productId);
    const stockByProduct = new Map(currentBalances.map((row) => [row.productId, row.quantity]));
    const reservedByProduct = new Map(reservedRows.map((row) => [row.productId, Number(row.quantity)]));
    const productById = new Map(activeProducts.map((product) => [product.id, product]));
    for (const line of input.lines) {
      const available = (stockByProduct.get(line.productId) ?? 0) - (reservedByProduct.get(line.productId) ?? 0);
      if (line.quantity > available) {
        const productName = productById.get(line.productId)?.name ?? "An item";
        throw new InventoryError(`${productName} no longer has enough available stock. Refresh your order and try again.`, 409);
      }
    }

    const [operation] = await tx.insert(operations).values({
      ownerId: workspace.ownerId,
      type: "delivery",
      origin: "storefront",
      status: "ready",
      contact: customerName,
      customerEmail,
      sourceLocationId: location.id,
    }).returning({ id: operations.id });
    const reference = `DLV-${operation.id.toString().padStart(4, "0")}`;
    await tx.update(operations).set({ reference }).where(eq(operations.id, operation.id));
    await tx.insert(operationLines).values(input.lines.map((line) => {
      const product = productById.get(line.productId)!;
      const unitPriceMinor = product.sellingPriceMinor
        ?? (product.sellingPriceCents === null
          ? null
          : Math.round((product.sellingPriceCents / 100) * (10 ** currencyDigits(product.sellingPriceCurrency))));
      return {
        ownerId: workspace.ownerId,
        operationId: operation.id,
        productId: line.productId,
        quantity: line.quantity,
        countedQuantity: null,
        unitPriceMinor,
        unitPriceCurrency: unitPriceMinor === null ? null : product.sellingPriceCurrency,
      };
    }));
    await tx.insert(deliveryConfirmations).values({
      operationId: operation.id,
      ownerId: workspace.ownerId,
      customerPhone: input.customerPhone,
      deliveryAddress,
    });
    return { reference };
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(CreatePublicStorefrontOrderResponse.parse({
    reference: result.reference,
    message: "Your order request has been sent to the seller. Payment is arranged with the seller offline or on delivery.",
  }));
});

export { publicRouter as publicStorefrontRouter, settingsRouter as storefrontSettingsRouter };
