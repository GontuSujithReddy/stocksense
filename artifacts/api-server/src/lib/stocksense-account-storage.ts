import { and, eq, inArray } from "drizzle-orm";
import { db, products, storefrontAssets } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

const objectStorage = new ObjectStorageService();

/**
 * Removes owner-uploaded storefront files unless a remaining product needs
 * them for Delivery history. Database rows are deleted only after the object
 * deletion succeeds, so a later retry can resume from any partial failure.
 */
export async function deleteUnusedStocksenseAccountAssets(ownerId: string): Promise<void> {
  const assets = await db
    .select({ id: storefrontAssets.id, objectPath: storefrontAssets.objectPath })
    .from(storefrontAssets)
    .where(eq(storefrontAssets.ownerId, ownerId));

  if (assets.length === 0) return;

  const assetIds = assets.map(({ id }) => id);
  const referencedAssets = await db
    .select({ imageAssetId: products.imageAssetId })
    .from(products)
    .where(inArray(products.imageAssetId, assetIds));
  const retainedAssetIds = new Set(
    referencedAssets.flatMap(({ imageAssetId }) => imageAssetId === null ? [] : [imageAssetId]),
  );

  for (const asset of assets) {
    if (retainedAssetIds.has(asset.id)) continue;
    if (!asset.objectPath.startsWith("/objects/")) {
      throw new Error("A StockSense storefront asset has an unsupported storage path.");
    }

    try {
      const file = await objectStorage.getObjectEntityFile(asset.objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }

    await db.delete(storefrontAssets).where(and(
      eq(storefrontAssets.id, asset.id),
      eq(storefrontAssets.ownerId, ownerId),
    ));
  }
}
