import { and, eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { Router, type IRouter, type Response } from "express";
import type { File } from "@google-cloud/storage";
import { db, inventoryWorkspaces, products, storefrontAssets } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

export const publicStorefrontAssetRouter: IRouter = Router();
export const publicStorageObjectsRouter: IRouter = Router();
const objectStorage = new ObjectStorageService();
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

async function sendObject(res: Response, file: File, cacheControl: string) {
  const response = await objectStorage.downloadObject(file, 300);
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (response.body) {
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  } else {
    res.end();
  }
}

publicStorefrontAssetRouter.get("/storefronts/:slug/assets/:assetId", async (req, res): Promise<void> => {
  const assetId = Number(req.params.assetId);
  if (!Number.isSafeInteger(assetId) || assetId < 1) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const [workspace, asset] = await Promise.all([
    db.select({
      ownerId: inventoryWorkspaces.ownerId,
      publishedHeroId: inventoryWorkspaces.storefrontPublishedDesign,
      deletedAt: inventoryWorkspaces.deletedAt,
    }).from(inventoryWorkspaces).where(eq(inventoryWorkspaces.storefrontSlug, req.params.slug)).limit(1),
    db.select().from(storefrontAssets).where(eq(storefrontAssets.id, assetId)).limit(1),
  ]);
  const seller = workspace[0];
  const image = asset[0];
  if (!seller || seller.deletedAt || !image || image.ownerId !== seller.ownerId || !imageTypes.has(image.contentType)) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const isPublishedHero = seller.publishedHeroId?.heroImageAssetId === assetId;
  const [productImage] = isPublishedHero ? [undefined] : await db.select({ id: products.id }).from(products).where(and(
    eq(products.ownerId, seller.ownerId),
    eq(products.imageAssetId, assetId),
    eq(products.active, true),
  )).limit(1);
  if (!isPublishedHero && !productImage) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(image.objectPath);
    await sendObject(res, file, "public, max-age=300, stale-while-revalidate=600");
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Image not found." });
      return;
    }
    throw error;
  }
});

publicStorageObjectsRouter.get("/storage/public-objects/*filePath", async (req, res): Promise<void> => {
  const rawPath = req.params.filePath;
  const filePath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  try {
    const file = await objectStorage.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    await sendObject(res, file, "public, max-age=3600");
  } catch (error) {
    throw error;
  }
});
