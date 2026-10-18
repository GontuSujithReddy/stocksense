import { and, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  balances,
  categories,
  locations,
  operationLines,
  operations,
  products,
  storefrontAssets,
  stockMoves,
} from "@workspace/db";
import {
  ListProductsQueryParams,
  ListProductsResponse,
  CreateProductBody,
  CreateProductResponse,
  GetProductParams,
  GetProductResponse,
  UpdateProductParams,
  UpdateProductBody,
  UpdateProductResponse,
  DeleteProductParams,
  ArchiveProductWithStockParams,
  ListCategoriesResponse,
  CreateCategoryBody,
  CreateCategoryResponse,
  UpdateCategoryParams,
  UpdateCategoryBody,
  UpdateCategoryResponse,
  DeleteCategoryParams,
} from "@workspace/api-zod";
import { enrichedProducts } from "../lib/inventory-queries";
import { InventoryError } from "../lib/inventory-error";
import { priceFields } from "../lib/pricing";

const DEFAULT_IMAGE_FIT = { x: 0.5, y: 0.5, zoom: 1 };

const router: IRouter = Router();

async function requireCategory(ownerId: string, categoryId: number | null | undefined) {
  if (categoryId == null) return;
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.ownerId, ownerId)))
    .limit(1);
  if (!category) throw new InventoryError("Choose a category in your inventory.", 400);
}

async function requireLocation(ownerId: string, locationId: number | null | undefined) {
  if (locationId == null) return;
  const [location] = await db.select({ id: locations.id }).from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.ownerId, ownerId))).limit(1);
  if (!location) throw new InventoryError("Choose a location in your inventory.", 400);
}

async function requireImageAsset(ownerId: string, imageAssetId: number | null | undefined) {
  if (imageAssetId == null) return;
  const [asset] = await db.select({ id: storefrontAssets.id }).from(storefrontAssets)
    .where(and(eq(storefrontAssets.id, imageAssetId), eq(storefrontAssets.ownerId, ownerId))).limit(1);
  if (!asset) throw new InventoryError("Choose an image uploaded to your workspace.", 400);
}

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, categoryId, warehouseId, stockStatus } = parsed.data;
  const all = await enrichedProducts(res.locals.ownerId, warehouseId);
  const term = search?.trim().toLowerCase();
  const filtered = all.filter((product) =>
    (!term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term)) &&
    (categoryId == null || product.categoryId === categoryId) &&
    (!stockStatus || stockStatus === "all" || product.stockStatus === stockStatus),
  );
  res.json(ListProductsResponse.parse(filtered));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const { name, sku, categoryId, imageAssetId, imageFit, unit, reorderPoint, sellingPrice, sellingPriceUsd, currencyCode, initialStock, initialLocationId, defaultLocationId } = parsed.data;
  const price = priceFields(sellingPrice, sellingPriceUsd, currencyCode, currencyCode ?? "USD");
  if (/^[\d.,\s]+$/.test(unit.trim())) throw new InventoryError("Unit must be a name such as pieces or boxes, not a stock quantity.", 400);
  if (initialStock !== undefined && (!Number.isFinite(initialStock) || initialStock < 0 ||
    initialStock > 100_000_000 || Math.round(initialStock * 1_000_000) / 1_000_000 !== initialStock)) {
    throw new InventoryError("Opening stock must be from 0 to 100,000,000 with at most six decimal places.", 400);
  }
  await requireCategory(ownerId, categoryId);
  await requireLocation(ownerId, defaultLocationId);
  await requireImageAsset(ownerId, imageAssetId);
  const openingStockLocationId = initialLocationId ?? defaultLocationId;
  if ((initialStock ?? 0) > 0) {
    if (!openingStockLocationId) {
      throw new InventoryError("Choose a location for the initial stock.");
    }
    await requireLocation(ownerId, openingStockLocationId);
  }

  const createdId = await db.transaction(async (tx) => {
    const [product] = await tx.insert(products).values({
      ownerId,
      name: name.trim(),
      sku: sku.trim(),
      categoryId: categoryId ?? null,
      imageAssetId: imageAssetId ?? null,
      imageFit: imageFit ?? DEFAULT_IMAGE_FIT,
      defaultLocationId: defaultLocationId ?? null,
      unit: unit.trim(),
      reorderPoint: reorderPoint ?? 0,
      ...price,
    }).returning();
    if ((initialStock ?? 0) > 0 && openingStockLocationId) {
      await tx.insert(balances).values({
        ownerId,
        productId: product.id,
        locationId: openingStockLocationId,
        quantity: initialStock!,
      });
      await tx.insert(stockMoves).values({
        ownerId,
        operationId: null,
        productId: product.id,
        type: "adjustment",
        reference: `OPEN-${product.id.toString().padStart(4, "0")}`,
        destinationLocationId: openingStockLocationId,
        quantity: initialStock!,
      });
    }
    return product.id;
  });
  const product = (await enrichedProducts(ownerId)).find((item) => item.id === createdId);
  res.status(201).json(CreateProductResponse.parse(product));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const product = (await enrichedProducts(res.locals.ownerId)).find((item) => item.id === params.data.id);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(GetProductResponse.parse(product));
});

router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request." });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  await requireCategory(ownerId, parsed.data.categoryId);
  await requireLocation(ownerId, parsed.data.defaultLocationId);
  await requireImageAsset(ownerId, parsed.data.imageAssetId);
  const { sellingPriceUsd, sellingPrice, currencyCode, imageFit, ...updates } = parsed.data;
  if (parsed.data.unit !== undefined && /^[\d.,\s]+$/.test(parsed.data.unit.trim())) {
    throw new InventoryError("Unit must be a name such as pieces or boxes, not a stock quantity.", 400);
  }
  const [existing] = await db.select({
    currency: products.sellingPriceCurrency,
    imageAssetId: products.imageAssetId,
  }).from(products)
    .where(and(eq(products.id, params.data.id), eq(products.ownerId, ownerId), eq(products.active, true))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const price = priceFields(sellingPrice, sellingPriceUsd, currencyCode, existing.currency);
  const imageAssetChanged = parsed.data.imageAssetId !== undefined && parsed.data.imageAssetId !== existing.imageAssetId;
  const nextImageFit = imageFit ?? (imageAssetChanged ? DEFAULT_IMAGE_FIT : undefined);
  const [updated] = await db.update(products).set({
    ...updates,
    ...(nextImageFit ? { imageFit: nextImageFit } : {}),
    ...price,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku.trim() } : {}),
    ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit.trim() } : {}),
  }).where(and(eq(products.id, params.data.id), eq(products.ownerId, ownerId), eq(products.active, true)))
    .returning({ id: products.id });
  if (!updated) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const product = (await enrichedProducts(ownerId)).find((item) => item.id === updated.id);
  res.json(UpdateProductResponse.parse(product));
});

async function archiveProduct(ownerId: string, productId: number, clearStock: boolean) {
  return db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products)
      .where(and(eq(products.ownerId, ownerId), eq(products.id, productId), eq(products.active, true)))
      .for("update");
    if (!product) return false;

    const [pendingStorefrontOrder] = await tx.select({ id: operations.id })
      .from(operations).innerJoin(operationLines, eq(operationLines.operationId, operations.id))
      .where(and(
        eq(operations.ownerId, ownerId),
        eq(operations.origin, "storefront"),
        eq(operationLines.ownerId, ownerId),
        eq(operationLines.productId, product.id),
        inArray(operations.status, ["draft", "waiting", "ready"]),
      )).limit(1);
    if (pendingStorefrontOrder) {
      throw new InventoryError("This product is reserved by a pending storefront order. Cancel that order before archiving the product.", 409);
    }

    const productBalances = await tx.select({
      locationId: balances.locationId,
      quantity: balances.quantity,
    }).from(balances)
      .where(and(eq(balances.ownerId, ownerId), eq(balances.productId, product.id)))
      .for("update");
    if (!clearStock && productBalances.some((balance) => balance.quantity !== 0)) {
      throw new InventoryError("This product still has stock. Choose Clear stock and archive to remove it from all locations.", 409);
    }
    if (clearStock) {
      const nonzero = productBalances.filter((balance) => balance.quantity !== 0);
      if (nonzero.length) {
        await tx.insert(stockMoves).values(nonzero.map((balance) => ({
          ownerId,
          operationId: null,
          productId: product.id,
          type: "adjustment",
          reference: `ARCH-${product.id.toString().padStart(4, "0")}`,
          sourceLocationId: balance.quantity > 0 ? balance.locationId : null,
          destinationLocationId: balance.quantity < 0 ? balance.locationId : null,
          quantity: -balance.quantity,
        })));
        await tx.update(balances).set({ quantity: 0 })
          .where(and(eq(balances.ownerId, ownerId), eq(balances.productId, product.id)));
      }
    }
    await tx.update(products).set({ active: false })
      .where(and(eq(products.ownerId, ownerId), eq(products.id, product.id)));
    return true;
  });
}

router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await archiveProduct(res.locals.ownerId as string, params.data.id, false)) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/products/:id/archive-with-stock", async (req, res): Promise<void> => {
  const params = ArchiveProductWithStockParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!await archiveProduct(res.locals.ownerId as string, params.data.id, true)) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  req.log.info({ productId: params.data.id }, "Product stock cleared and product archived");
  res.sendStatus(204);
});

router.get("/categories", async (_req, res): Promise<void> => {
  const ownerId = res.locals.ownerId as string;
  const [categoryRows, productRows] = await Promise.all([
    db.select().from(categories).where(eq(categories.ownerId, ownerId)),
    db.select({ categoryId: products.categoryId }).from(products)
      .where(and(eq(products.ownerId, ownerId), eq(products.active, true))),
  ]);
  res.json(ListCategoriesResponse.parse(categoryRows.map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    productCount: productRows.filter((product) => product.categoryId === category.id).length,
  }))));
});

router.post("/categories", async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [category] = await db.insert(categories).values({
    ownerId: res.locals.ownerId,
    name: parsed.data.name.trim(),
    color: parsed.data.color ?? "#467B68",
  }).returning();
  res.status(201).json(CreateCategoryResponse.parse({ ...category, productCount: 0 }));
});

router.patch("/categories/:id", async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params);
  const parsed = UpdateCategoryBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request." });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const [category] = await db.update(categories).set({
    ...parsed.data,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
  }).where(and(eq(categories.id, params.data.id), eq(categories.ownerId, ownerId))).returning();
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  const productRows = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.ownerId, ownerId), eq(products.categoryId, category.id), eq(products.active, true)));
  res.json(UpdateCategoryResponse.parse({ ...category, productCount: productRows.length }));
});

router.delete("/categories/:id", async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const productRows = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.ownerId, ownerId), eq(products.categoryId, params.data.id))).limit(1);
  if (productRows.length) {
    res.status(409).json({ error: "Reassign products before deleting this category." });
    return;
  }
  const [deleted] = await db.delete(categories).where(and(eq(categories.id, params.data.id), eq(categories.ownerId, ownerId)))
    .returning({ id: categories.id });
  if (!deleted) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;