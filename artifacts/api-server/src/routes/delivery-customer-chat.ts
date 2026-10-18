import { and, asc, eq, gt } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { db, deliveryChatMessages, deliveryChatTokens, deliveryProfiles, operations } from "@workspace/db";
import {
  GetCustomerDeliveryChatHeader,
  GetCustomerDeliveryChatResponse,
  SendCustomerDeliveryMessageBody,
  SendCustomerDeliveryMessageHeader,
  SendCustomerDeliveryMessageResponse,
} from "@workspace/api-zod";
import { hashDeliveryChatToken } from "../lib/delivery-otp";
import { InventoryError } from "../lib/inventory-error";

const router: IRouter = Router();

function parseToken(req: Request, schema: typeof GetCustomerDeliveryChatHeader | typeof SendCustomerDeliveryMessageHeader): string {
  const parsed = schema.safeParse({ "X-Delivery-Chat-Token": req.get("X-Delivery-Chat-Token") ?? "" });
  const token = parsed.success ? parsed.data["X-Delivery-Chat-Token"] : "";
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new InventoryError("This delivery chat link is invalid or has expired.", 404);
  }
  return token;
}

async function findThread(token: string) {
  const now = new Date();
  const [access] = await db.select({ operationId: deliveryChatTokens.operationId }).from(deliveryChatTokens)
    .where(and(
      eq(deliveryChatTokens.tokenHash, hashDeliveryChatToken(token)),
      gt(deliveryChatTokens.expiresAt, now),
    )).limit(1);
  if (!access) return null;

  const [operation] = await db.select().from(operations)
    .where(eq(operations.id, access.operationId)).limit(1);
  if (!operation || operation.type !== "delivery" || operation.status === "canceled") return null;

  const [courier] = operation.courierUserId
    ? await db.select({ name: deliveryProfiles.name }).from(deliveryProfiles).where(and(
      eq(deliveryProfiles.userId, operation.courierUserId),
      eq(deliveryProfiles.role, "courier"),
    )).limit(1)
    : [];
  const messages = await db.select().from(deliveryChatMessages)
    .where(eq(deliveryChatMessages.operationId, operation.id))
    .orderBy(asc(deliveryChatMessages.createdAt), asc(deliveryChatMessages.id));
  return {
    reference: operation.reference,
    customerName: operation.contact,
    courierName: courier?.name ?? null,
    closed: !!operation.deliveryCompletedAt || operation.status === "canceled",
    messages: messages.map(message => ({
      id: message.id,
      sender: message.sender,
      message: message.message,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

router.get("/delivery-chat", async (req, res): Promise<void> => {
  const token = parseToken(req, GetCustomerDeliveryChatHeader);
  const thread = await findThread(token);
  if (!thread) {
    res.status(404).json({ error: "This delivery chat link is invalid or has expired." });
    return;
  }
  res.json(GetCustomerDeliveryChatResponse.parse(thread));
});

router.post("/delivery-chat", async (req, res): Promise<void> => {
  const token = parseToken(req, SendCustomerDeliveryMessageHeader);
  const parsed = SendCustomerDeliveryMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const message = parsed.data.message.trim();
  if (!message) {
    res.status(400).json({ error: "Enter a message before sending." });
    return;
  }

  const result = await db.transaction(async tx => {
    const [access] = await tx.select({ operationId: deliveryChatTokens.operationId }).from(deliveryChatTokens)
      .where(and(
        eq(deliveryChatTokens.tokenHash, hashDeliveryChatToken(token)),
        gt(deliveryChatTokens.expiresAt, new Date()),
      )).limit(1);
    if (!access) return { error: "invalid-link" as const };
    const [operation] = await tx.select().from(operations)
      .where(eq(operations.id, access.operationId)).for("update");
    if (!operation || operation.type !== "delivery" || operation.status === "canceled") {
      return { error: "invalid-link" as const };
    }
    if (operation.deliveryCompletedAt) return { error: "closed" as const };
    const [saved] = await tx.insert(deliveryChatMessages).values({
      operationId: operation.id,
      sender: "customer",
      message,
    }).returning();
    return { message: saved };
  });

  if ("error" in result) {
    if (result.error === "invalid-link") {
      res.status(404).json({ error: "This delivery chat link is invalid or has expired." });
      return;
    }
    throw new InventoryError("This delivery chat is closed.", 409);
  }
  res.status(201).json(SendCustomerDeliveryMessageResponse.parse({
    id: result.message.id,
    sender: result.message.sender,
    message: result.message.message,
    createdAt: result.message.createdAt.toISOString(),
  }));
});

export default router;
