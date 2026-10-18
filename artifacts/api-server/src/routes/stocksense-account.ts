import { HindsightError, createClient, createConfig, sdk as hindsightSdk } from "@vectorize-io/hindsight-client";
import { GetStocksenseAccountStatusResponse } from "@workspace/api-zod";
import { db, inventoryWorkspaces } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import { deliveryRole } from "../lib/delivery-access";
import { deleteStocksenseAccountData } from "../lib/stocksense-account-deletion";
import { deleteUnusedStocksenseAccountAssets } from "../lib/stocksense-account-storage";
import { stocksenseMemoryBankId } from "../lib/stocksense-memory";

const router: IRouter = Router();

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && typeof error.status === "number") return error.status;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  return undefined;
}

async function isConfiguredMainAdmin(userId: string): Promise<boolean> {
  const configuredEmail = process.env.STOCKSENSE_MAIN_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredEmail) return false;

  try {
    const user = await clerkClient.users.getUser(userId);
    return user.emailAddresses.some(address =>
      address.verification?.status === "verified"
      && address.emailAddress.trim().toLowerCase() === configuredEmail,
    );
  } catch (error) {
    // A previously completed deletion may be retried with a still-cached session.
    if (errorStatus(error) === 404) return false;
    throw error;
  }
}

router.get("/stocksense/account", async (req, res): Promise<void> => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) {
    res.status(401).json({ error: "Please sign in to view your StockSense account." });
    return;
  }

  const [workspace] = await db
    .select({ deletedAt: inventoryWorkspaces.deletedAt })
    .from(inventoryWorkspaces)
    .where(eq(inventoryWorkspaces.ownerId, ownerId))
    .limit(1);
  const deleted = workspace?.deletedAt != null;
  const role = deleted ? null : await deliveryRole(ownerId);
  res.json(GetStocksenseAccountStatusResponse.parse({
    deleted,
    canDelete: role === "owner" && !deleted,
  }));
});

router.delete("/stocksense/account", async (req, res): Promise<void> => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) {
    res.status(401).json({ error: "Please sign in to delete your account." });
    return;
  }

  const [workspace] = await db
    .select({ deletedAt: inventoryWorkspaces.deletedAt })
    .from(inventoryWorkspaces)
    .where(eq(inventoryWorkspaces.ownerId, ownerId))
    .limit(1);
  const deletionAlreadyStarted = workspace?.deletedAt != null;

  if (!deletionAlreadyStarted && await deliveryRole(ownerId) !== "owner") {
    res.status(403).json({ error: "Only a StockSense owner can delete this account." });
    return;
  }

  try {
    if (await isConfiguredMainAdmin(ownerId)) {
      res.status(409).json({
        error: deletionAlreadyStarted
          ? "Transfer StockSense main administrator access before completing this deletion. Previously removed data remains deleted."
          : "Transfer StockSense main administrator access before deleting this account. No account data was deleted.",
      });
      return;
    }
  } catch (error) {
    req.log.error({
      statusCode: errorStatus(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "StockSense main administrator status could not be verified");
    res.status(503).json({
      error: deletionAlreadyStarted
        ? "The account's administrator status could not be verified. No new cleanup steps ran; keep this session and retry shortly."
        : "The account's administrator status could not be verified. No account data was deleted; retry shortly.",
    });
    return;
  }

  if (!deletionAlreadyStarted) {
    const baseUrl = process.env.HINDSIGHT_URL?.trim();
    const apiKey = process.env.HINDSIGHT_API_KEY?.trim();
    if (!baseUrl || !apiKey) {
      res.status(503).json({ error: "StockSense memory deletion is not configured. No account data was deleted." });
      return;
    }

    try {
      const provider = createClient(createConfig({
        baseUrl,
        headers: { Authorization: `Bearer ${apiKey}` },
      }));
      const response = await hindsightSdk.deleteBank({
        client: provider,
        path: { bank_id: stocksenseMemoryBankId(ownerId) },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.error && response.response?.status !== 404) {
        throw new HindsightError(
          "Hindsight bank deletion failed",
          response.response?.status,
          response.error,
        );
      }
    } catch (error) {
      const statusCode = error instanceof HindsightError ? error.statusCode : undefined;
      const timeout = error instanceof Error
        && (error.name === "TimeoutError" || error.name === "AbortError");
      req.log.error({
        statusCode,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "StockSense memory deletion failed");
      const authorizationRejected = statusCode === 401 || statusCode === 403;
      res.status(timeout ? 504 : 502).json({
        error: authorizationRejected
          ? "StockSense's memory service did not authorize deletion. No account data was deleted; an administrator must reconnect or grant access to the memory service before you retry."
          : "StockSense memory deletion could not be confirmed. No account data was deleted; retry to continue.",
      });
      return;
    }

  }

  try {
    // The remaining asset rows act as an idempotent work queue for object
    // storage, including on retries after the database tombstone is committed.
    await deleteStocksenseAccountData(ownerId);
  } catch (error) {
    req.log.error({
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, deletionAlreadyStarted
      ? "StockSense account cleanup retry failed"
      : "StockSense database cleanup failed after memory bank deletion");
    res.status(500).json({
      error: deletionAlreadyStarted
        ? "Account cleanup did not finish. Any committed steps are safe to retry; keep this session and try again."
        : "The StockSense memory bank was deleted, but database cleanup did not finish. The database transaction was rolled back; retry to complete deletion.",
    });
    return;
  }

  try {
    await deleteUnusedStocksenseAccountAssets(ownerId);
  } catch (error) {
    req.log.error({
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "StockSense storefront asset cleanup failed");
    res.status(502).json({
      error: "Account data and Delivery settings were removed, but some StockSense files could not be deleted. Keep this session and retry to finish.",
    });
    return;
  }

  try {
    await clerkClient.users.deleteUser(ownerId);
  } catch (error) {
    if (errorStatus(error) !== 404) {
      req.log.error({
        statusCode: errorStatus(error),
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Shared sign-in deletion failed after local account cleanup");
      res.status(502).json({
        error: "StockSense data and Delivery profile/settings were removed, but the shared sign-in could not be deleted. Keep this session and retry to finish.",
      });
      return;
    }
  }

  res.sendStatus(204);
});

export default router;