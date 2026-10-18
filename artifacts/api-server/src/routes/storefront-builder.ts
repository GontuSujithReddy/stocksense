import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  inventoryWorkspaces,
  locations,
  operationLines,
  operations,
  products,
  storefrontAssets,
  warehouses,
} from "@workspace/db";
import {
  GenerateStorefrontDesignBody,
  GenerateStorefrontDesignResponse,
  GenerateStorefrontHeroBody,
  GenerateStorefrontHeroResponse,
  GetStorefrontAnalyticsQueryParams,
  GetStorefrontAnalyticsResponse,
  GetStorefrontBuilderResponse,
  PublishStorefrontBody,
  PublishStorefrontResponse,
  RequestStorefrontAssetUploadBody,
  RequestStorefrontAssetUploadResponse,
  SaveStorefrontDraftBody,
  SaveStorefrontDraftResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { currencyDigits } from "../lib/pricing";
import { InventoryError } from "../lib/inventory-error";

export const storefrontBuilderRouter: IRouter = Router();
const objectStorage = new ObjectStorageService();
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const generationLimit = 5;
const generationWindowMs = 10 * 60 * 1000;
const generationAttempts = new Map<string, { count: number; resetAt: number }>();

function allowGeneration(ownerId: string): boolean {
  const now = Date.now();
  const current = generationAttempts.get(ownerId);
  if (!current || current.resetAt <= now) {
    generationAttempts.set(ownerId, { count: 1, resetAt: now + generationWindowMs });
    return true;
  }
  if (current.count >= generationLimit) return false;
  current.count += 1;
  return true;
}

async function builderState(ownerId: string) {
  const [workspace, locationRows] = await Promise.all([
    db.select({
      slug: inventoryWorkspaces.storefrontSlug,
      fulfillmentLocationId: inventoryWorkspaces.storefrontLocationId,
      draftDesign: inventoryWorkspaces.storefrontDraftDesign,
      publishedDesign: inventoryWorkspaces.storefrontPublishedDesign,
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
  return GetStorefrontBuilderResponse.parse({
    slug: workspace[0]?.slug ?? null,
    fulfillmentLocationId: workspace[0]?.fulfillmentLocationId ?? null,
    draftDesign: workspace[0]?.draftDesign ?? null,
    publishedDesign: workspace[0]?.publishedDesign ?? null,
    locations: locationRows,
  });
}

async function getStorefrontReportingWindow(ownerId: string, requestedPeriodDays: number, now = new Date()) {
  const [workspace] = await db.select({
    createdAt: inventoryWorkspaces.storefrontCreatedAt,
    slug: inventoryWorkspaces.storefrontSlug,
    publishedDesign: inventoryWorkspaces.storefrontPublishedDesign,
  }).from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, ownerId)).limit(1);
  let createdAt = workspace?.createdAt ?? null;

  if (!createdAt) {
    const [oldestRequest] = await db.select({
      createdAt: sql<Date | null>`min(${operations.createdAt})`,
    }).from(operations).where(and(
      eq(operations.ownerId, ownerId),
      eq(operations.origin, "storefront"),
    ));
    if (workspace && (workspace.slug || workspace.publishedDesign || oldestRequest?.createdAt)) {
      const fallbackCreatedAt = oldestRequest?.createdAt ?? now;
      await db.update(inventoryWorkspaces).set({ storefrontCreatedAt: fallbackCreatedAt })
        .where(and(
          eq(inventoryWorkspaces.ownerId, ownerId),
          isNull(inventoryWorkspaces.storefrontCreatedAt),
        ));
      const [saved] = await db.select({ createdAt: inventoryWorkspaces.storefrontCreatedAt })
        .from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, ownerId)).limit(1);
      createdAt = saved?.createdAt ?? fallbackCreatedAt;
    }
  }

  if (!createdAt) return { createdAt: null, periodDays: 0, maxPeriodDays: 0 };

  const fullDaysSinceCreation = Math.floor(Math.max(0, now.getTime() - createdAt.getTime()) / 86_400_000);
  const maxPeriodDays = Math.max(1, fullDaysSinceCreation);
  return {
    createdAt,
    periodDays: Math.min(requestedPeriodDays, maxPeriodDays),
    maxPeriodDays,
  };
}

async function requireOwnedAsset(ownerId: string, assetId: number | null | undefined): Promise<void> {
  if (assetId == null) return;
  const [asset] = await db.select({ id: storefrontAssets.id }).from(storefrontAssets)
    .where(and(eq(storefrontAssets.id, assetId), eq(storefrontAssets.ownerId, ownerId))).limit(1);
  if (!asset) throw new InventoryError("Choose an image uploaded to your workspace.", 400);
}

storefrontBuilderRouter.get("/storefront/builder", async (_req, res): Promise<void> => {
  res.json(await builderState(res.locals.ownerId as string));
});

storefrontBuilderRouter.post("/storefront/builder/generate", async (req, res): Promise<void> => {
  const parsed = GenerateStorefrontDesignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  if (!allowGeneration(ownerId)) {
    res.status(429).json({ error: "Too many AI generations. Try again in a few minutes." });
    return;
  }
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Design a small seller's ecommerce storefront from the seller's description.",
            "Return JSON only with storeName, tagline, description, theme, layout, and heroImageAssetId.",
            "theme must be evergreen, ocean, or sunrise. layout must be showcase, catalog, or editorial.",
            "Set heroImageAssetId to null. Do not generate HTML, CSS, JavaScript, prices, SKUs, stock, policies, reviews, or factual product claims.",
            "Use only the seller's facts. Keep storeName at most 80 characters, tagline at most 120, and description at most 500.",
          ].join(" "),
        },
        { role: "user", content: parsed.data.prompt.trim() },
      ],
    });
    const content = result.choices[0]?.message?.content;
    if (!content) throw new Error("The AI response was empty.");
    const value = JSON.parse(content) as Record<string, unknown>;
    const design = GenerateStorefrontDesignResponse.parse({
      ...value,
      heroImageAssetId: null,
    });
    res.json(design);
  } catch (error) {
    console.error("Storefront design generation failed:", error);
    res.status(502).json({ error: "The store draft could not be generated. Please try again." });
  }
});

storefrontBuilderRouter.post("/storefront/builder/generate-hero", async (req, res): Promise<void> => {
  const parsed = GenerateStorefrontHeroBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  if (!allowGeneration(ownerId)) {
    res.status(429).json({ error: "Too many AI generations. Try again in a few minutes." });
    return;
  }
  try {
    const image = await generateImageBuffer(
      `Create a polished, wide editorial ecommerce hero image for this seller's store. ${parsed.data.prompt.trim()}. No text, logos, badges, watermarks, or fake product packaging.`,
      "1024x1024",
    );
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    const upload = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(image),
    });
    if (!upload.ok) throw new Error(`Image storage returned ${upload.status}.`);
    const [asset] = await db.insert(storefrontAssets).values({
      ownerId,
      objectPath,
      contentType: "image/png",
      byteSize: image.byteLength,
    }).returning({ id: storefrontAssets.id });
    res.status(201).json(GenerateStorefrontHeroResponse.parse({ imageAssetId: asset.id }));
  } catch (error) {
    console.error("Storefront hero generation failed:", error);
    res.status(502).json({ error: "The hero image could not be generated. Please try again." });
  }
});

storefrontBuilderRouter.put("/storefront/builder/draft", async (req, res): Promise<void> => {
  const parsed = SaveStorefrontDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  await requireOwnedAsset(ownerId, parsed.data.heroImageAssetId);
  const [workspace] = await db.select({ deletedAt: inventoryWorkspaces.deletedAt })
    .from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, ownerId)).limit(1);
  if (workspace?.deletedAt) throw new InventoryError("This inventory workspace is unavailable.", 403);
  await db.update(inventoryWorkspaces).set({ storefrontDraftDesign: parsed.data })
    .where(eq(inventoryWorkspaces.ownerId, ownerId));
  res.json(SaveStorefrontDraftResponse.parse(await builderState(ownerId)));
});

storefrontBuilderRouter.post("/storefront/builder/publish", async (req, res): Promise<void> => {
  const parsed = PublishStorefrontBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  if (!slugPattern.test(parsed.data.slug)) {
    res.status(400).json({ error: "Use 3–40 lowercase letters, numbers, or hyphens for the store URL." });
    return;
  }
  const [location] = await db.select({ id: locations.id }).from(locations).where(and(
    eq(locations.id, parsed.data.fulfillmentLocationId),
    eq(locations.ownerId, ownerId),
    eq(locations.kind, "internal"),
  )).limit(1);
  if (!location) throw new InventoryError("Choose an internal stock location in your workspace.", 400);
  const [workspace] = await db.select({
    deletedAt: inventoryWorkspaces.deletedAt,
    draftDesign: inventoryWorkspaces.storefrontDraftDesign,
    storefrontCreatedAt: inventoryWorkspaces.storefrontCreatedAt,
    slug: inventoryWorkspaces.storefrontSlug,
  }).from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, ownerId)).limit(1);
  if (workspace?.deletedAt) throw new InventoryError("This inventory workspace is unavailable.", 403);
  if (!workspace?.draftDesign) throw new InventoryError("Generate and save a store draft before publishing.", 400);
  await requireOwnedAsset(ownerId, workspace.draftDesign.heroImageAssetId);

  try {
    let storefrontCreatedAt = workspace.storefrontCreatedAt;
    if (!storefrontCreatedAt) {
      const [oldestRequest] = await db.select({
        createdAt: sql<Date | null>`min(${operations.createdAt})`,
      }).from(operations).where(and(
        eq(operations.ownerId, ownerId),
        eq(operations.origin, "storefront"),
      ));
      storefrontCreatedAt = oldestRequest?.createdAt ?? new Date();
    }
    await db.update(inventoryWorkspaces).set({
      storefrontSlug: parsed.data.slug,
      storefrontLocationId: parsed.data.fulfillmentLocationId,
      storefrontPublishedDesign: workspace.draftDesign,
      storefrontCreatedAt,
    }).where(eq(inventoryWorkspaces.ownerId, ownerId));
  } catch (error) {
    const databaseError = typeof error === "object" && error !== null && "cause" in error
      ? error.cause : error;
    if (typeof databaseError === "object" && databaseError !== null
      && "code" in databaseError && databaseError.code === "23505") {
      res.status(409).json({ error: "That store URL is already in use. Choose another." });
      return;
    }
    throw error;
  }
  res.json(PublishStorefrontResponse.parse(await builderState(ownerId)));
});

storefrontBuilderRouter.post("/storefront/assets/upload-url", async (req, res): Promise<void> => {
  const parsed = RequestStorefrontAssetUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!allowedImageTypes.has(parsed.data.contentType)) {
    res.status(400).json({ error: "Upload a PNG, JPEG, or WebP image." });
    return;
  }
  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    const [asset] = await db.insert(storefrontAssets).values({
      ownerId: res.locals.ownerId as string,
      objectPath,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.size,
    }).returning({ id: storefrontAssets.id });
    res.json(RequestStorefrontAssetUploadResponse.parse({ uploadURL, imageAssetId: asset.id }));
  } catch (error) {
    console.error("Storefront upload URL generation failed:", error);
    res.status(500).json({ error: "An upload link could not be created." });
  }
});

storefrontBuilderRouter.get("/storefront/analytics", async (req, res): Promise<void> => {
  const parsed = GetStorefrontAnalyticsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const now = new Date();
  const { createdAt, periodDays, maxPeriodDays } = await getStorefrontReportingWindow(
    ownerId,
    parsed.data.periodDays ?? 30,
    now,
  );
  if (!createdAt || periodDays === 0) {
    res.json(GetStorefrontAnalyticsResponse.parse({
      periodDays: 0,
      maxPeriodDays: 0,
      orderCount: 0,
      pendingReviewCount: 0,
      completedOperationCount: 0,
      canceledOrderCount: 0,
      unpricedOrderCount: 0,
      ordersByCurrency: [],
      topProducts: [],
      daily: [],
    }));
    return;
  }
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - periodDays + 1);
  if (createdAt > start) start.setTime(createdAt.getTime());
  const ownerOrders = and(
    eq(operations.ownerId, ownerId),
    eq(operations.origin, "storefront"),
    gte(operations.createdAt, start),
  );
  const dayExpression = sql<string>`to_char(date_trunc('day', ${operations.createdAt}), 'YYYY-MM-DD')`;
  const [orderRows, currencyRows, productRows, unpricedRows, dailyRows] = await Promise.all([
    db.select({ id: operations.id, status: operations.status }).from(operations).where(ownerOrders),
    db.select({
      currencyCode: operationLines.unitPriceCurrency,
      orderCount: sql<number>`count(distinct ${operationLines.operationId})`,
      minorValue: sql<number>`coalesce(sum(${operationLines.quantity} * ${operationLines.unitPriceMinor}), 0)`,
    }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
      .where(and(
        eq(operationLines.ownerId, ownerId),
        eq(operations.ownerId, ownerId),
        eq(operations.origin, "storefront"),
        gte(operations.createdAt, start),
        sql`${operationLines.unitPriceMinor} is not null`,
        sql`${operationLines.unitPriceCurrency} is not null`,
      )).groupBy(operationLines.unitPriceCurrency),
    db.select({
      productId: products.id,
      productName: products.name,
      currencyCode: operationLines.unitPriceCurrency,
      orderCount: sql<number>`count(distinct ${operationLines.operationId})`,
      quantity: sql<number>`coalesce(sum(${operationLines.quantity}), 0)`,
      minorValue: sql<number>`coalesce(sum(${operationLines.quantity} * ${operationLines.unitPriceMinor}), 0)`,
    }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
      .innerJoin(products, eq(products.id, operationLines.productId))
      .where(and(
        eq(operationLines.ownerId, ownerId),
        eq(operations.ownerId, ownerId),
        eq(operations.origin, "storefront"),
        gte(operations.createdAt, start),
        sql`${operationLines.unitPriceMinor} is not null`,
        sql`${operationLines.unitPriceCurrency} is not null`,
      )).groupBy(products.id, products.name, operationLines.unitPriceCurrency)
      .orderBy(desc(sql`sum(${operationLines.quantity} * ${operationLines.unitPriceMinor})`)).limit(10),
    db.select({
      count: sql<number>`count(distinct ${operationLines.operationId})`,
    }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
      .where(and(
        eq(operationLines.ownerId, ownerId),
        eq(operations.ownerId, ownerId),
        eq(operations.origin, "storefront"),
        gte(operations.createdAt, start),
        isNull(operationLines.unitPriceMinor),
      )),
    db.select({ date: dayExpression, orderCount: sql<number>`count(*)` })
      .from(operations).where(ownerOrders).groupBy(dayExpression).orderBy(dayExpression),
  ]);

  const dailyByDate = new Map(dailyRows.map((row) => [row.date, Number(row.orderCount)]));
  const firstDailyDate = new Date(start);
  firstDailyDate.setUTCHours(0, 0, 0, 0);
  const dailyCount = Math.max(0, Math.floor((today.getTime() - firstDailyDate.getTime()) / 86_400_000) + 1);
  const daily = Array.from({ length: dailyCount }, (_, index) => {
    const date = new Date(firstDailyDate);
    date.setUTCDate(firstDailyDate.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, orderCount: dailyByDate.get(key) ?? 0 };
  });
  const result = {
    periodDays,
    maxPeriodDays,
    orderCount: orderRows.length,
    pendingReviewCount: orderRows.filter((row) => ["draft", "waiting", "ready"].includes(row.status)).length,
    completedOperationCount: orderRows.filter((row) => row.status === "done").length,
    canceledOrderCount: orderRows.filter((row) => row.status === "canceled").length,
    unpricedOrderCount: Number(unpricedRows[0]?.count ?? 0),
    ordersByCurrency: currencyRows.map((row) => ({
      currencyCode: row.currencyCode!,
      orderCount: Number(row.orderCount),
      requestedValue: Number(row.minorValue) / (10 ** currencyDigits(row.currencyCode!)),
    })),
    topProducts: productRows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      currencyCode: row.currencyCode!,
      orderCount: Number(row.orderCount),
      quantity: Number(row.quantity),
      requestedValue: Number(row.minorValue) / (10 ** currencyDigits(row.currencyCode!)),
    })),
    daily,
  };
  res.json(GetStorefrontAnalyticsResponse.parse(result));
});

storefrontBuilderRouter.get("/storage/assets/:assetId", async (req, res): Promise<void> => {
  const assetId = Number(req.params.assetId);
  if (!Number.isSafeInteger(assetId) || assetId < 1) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const [asset] = await db.select().from(storefrontAssets).where(and(
    eq(storefrontAssets.id, assetId),
    eq(storefrontAssets.ownerId, res.locals.ownerId as string),
  )).limit(1);
  if (!asset || !allowedImageTypes.has(asset.contentType)) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(asset.objectPath);
    const response = await objectStorage.downloadObject(file, 300);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (response.body) {
      const { Readable } = await import("node:stream");
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Image not found." });
      return;
    }
    throw error;
  }
});
