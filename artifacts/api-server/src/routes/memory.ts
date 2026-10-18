import { getAuth } from "@clerk/express";
import { HindsightClient, HindsightError } from "@vectorize-io/hindsight-client";
import { RecallMemoryBody, RecallMemoryResponse } from "@workspace/api-zod";
import { db, inventoryWorkspaces } from "@workspace/db";
import { Router, type IRouter, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { stocksenseMemoryBankId } from "../lib/stocksense-memory";

const router: IRouter = Router();

export const requireMemoryAuth: RequestHandler = async (req, res, next) => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) {
    res.status(401).json({ error: "Please sign in to recall your memories." });
    return;
  }
  const [workspace] = await db
    .select({ deletedAt: inventoryWorkspaces.deletedAt })
    .from(inventoryWorkspaces)
    .where(eq(inventoryWorkspaces.ownerId, ownerId))
    .limit(1);
  if (workspace?.deletedAt) {
    res.status(410).json({ error: "Your StockSense memory has been permanently deleted." });
    return;
  }
  res.locals.ownerId = ownerId;
  next();
};

router.post("/recall", async (req, res): Promise<void> => {
  const parsed = RecallMemoryBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.query.trim()) {
    res.status(400).json({ error: "Enter a query of no more than 500 characters." });
    return;
  }

  const baseUrl = process.env.HINDSIGHT_URL?.trim();
  const apiKey = process.env.HINDSIGHT_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    res.status(503).json({ error: "Memory recall is not configured." });
    return;
  }

  const ownerId = res.locals.ownerId as string;
  const bankId = stocksenseMemoryBankId(ownerId);

  try {
    const client = new HindsightClient({ baseUrl, apiKey, maxAttempts: 1 });
    const recalled = await client.recall(bankId, parsed.data.query.trim(), {
      budget: "low",
      signal: AbortSignal.timeout(10_000),
    });
    res.json(RecallMemoryResponse.parse({
      results: recalled.results.map(({ id, text }) => ({ id, text })),
    }));
  } catch (error) {
    const statusCode = error instanceof HindsightError ? error.statusCode : undefined;
    req.log.error({
      statusCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "Memory recall failed");
    if (statusCode === 404) {
      res.status(404).json({ error: "Memory bank not found." });
      return;
    }
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    res.status(timeout ? 504 : 502).json({ error: timeout ? "Memory recall timed out." : "Memory recall failed." });
  }
});

export default router;