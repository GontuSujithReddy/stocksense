import { Router, type IRouter } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db, deliveryVoiceSettings, deliverySupport, deliverySupportMessages, operations } from "@workspace/db";
import {
  GetDeliveryVoiceSettingsResponse, SetupDeliveryVoiceBody, SetupDeliveryVoiceResponse,
  ListDeliverySupportResponse, CreateDeliverySupportBody, CreateDeliverySupportResponse,
  CreateDeliverySupportMessageBody, CreateDeliverySupportMessageResponse,
} from "@workspace/api-zod";
import { requireDeliveryOwner } from "../lib/delivery-access";
import { listRetellNumbers, setupRetellDeliveryAgent } from "../lib/delivery-retell";
import { InventoryError } from "../lib/inventory-error";
import { buildSupportConversation } from "../lib/delivery-support-conversation";

const router: IRouter = Router();
router.use(requireDeliveryOwner);

async function voiceSettings(ownerId: string) {
  const [config] = await db.select().from(deliveryVoiceSettings).where(eq(deliveryVoiceSettings.ownerId, ownerId)).limit(1);
  let numbers: string[] = [];
  let providerError: string | null = null;
  try { numbers = await listRetellNumbers(); }
  catch (error) { providerError = error instanceof Error ? error.message : "Unable to read Retell configuration."; }
  return { configured: !!config && !providerError && numbers.includes(config.fromNumber), fromNumber: config?.fromNumber ?? null,
    agentId: config?.agentId ?? null, numbers, providerError };
}
router.get("/voice", async (_req, res) => {
  res.json(GetDeliveryVoiceSettingsResponse.parse(await voiceSettings(res.locals.deliveryUserId)));
});
router.post("/voice", async (req, res) => {
  const parsed = SetupDeliveryVoiceBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const ownerId = res.locals.deliveryUserId as string;
  const numbers = await listRetellNumbers();
  if (!numbers.includes(parsed.data.fromNumber)) throw new InventoryError("Choose an existing caller number from your connected Retell account. This app does not purchase numbers.");
  // Serialize setup to avoid duplicated paid-provider resource creation on double clicks.
  const config = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delivery-voice:${ownerId}`}))`);
    const [existing] = await tx.select().from(deliveryVoiceSettings).where(eq(deliveryVoiceSettings.ownerId, ownerId)).limit(1);
    const agent = existing ?? await setupRetellDeliveryAgent();
    await tx.insert(deliveryVoiceSettings).values({
      ownerId, fromNumber: parsed.data.fromNumber, agentId: agent.agentId, flowId: agent.flowId,
    }).onConflictDoUpdate({
      target: deliveryVoiceSettings.ownerId,
      set: { fromNumber: parsed.data.fromNumber },
    });
    return agent;
  });
  res.json(SetupDeliveryVoiceResponse.parse({
    configured: true, fromNumber: parsed.data.fromNumber, agentId: config.agentId, numbers, providerError: null,
  }));
});
function supportView(row: typeof deliverySupport.$inferSelect, messages: typeof deliverySupportMessages.$inferSelect[]) {
  return { id: row.id, operationId: row.operationId, subject: row.subject, message: row.message,
    status: row.status, resolution: row.resolution, createdAt: row.createdAt.toISOString(),
    resolvedByName: row.resolvedByName, resolvedAt: row.resolvedAt?.toISOString() ?? null,
    messages: buildSupportConversation(row, messages) };
}
async function supportViews(rows: typeof deliverySupport.$inferSelect[]) {
  if (!rows.length) return [];
  const messages = await db.select().from(deliverySupportMessages)
    .where(inArray(deliverySupportMessages.ticketId, rows.map(row => row.id)));
  const grouped = new Map<number, typeof messages>();
  for (const message of messages) grouped.set(message.ticketId, [...(grouped.get(message.ticketId) ?? []), message]);
  return rows.map(row => supportView(row, grouped.get(row.id) ?? []));
}
router.get("/support", async (_req, res) => {
  const rows = await db.select().from(deliverySupport).where(and(
    eq(deliverySupport.sourceApp, "delivery"),
    eq(deliverySupport.ownerId, res.locals.deliveryUserId),
  )).orderBy(desc(deliverySupport.createdAt));
  res.json(ListDeliverySupportResponse.parse(await supportViews(rows)));
});
router.post("/support", async (req, res) => {
  const parsed = CreateDeliverySupportBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const ownerId = res.locals.deliveryUserId as string;
  const data = parsed.data;
  if (!data.subject.trim() || !data.message.trim()) throw new InventoryError("Enter both a subject and a message.");
  if (data.operationId != null) {
    const [operation] = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, data.operationId), eq(operations.ownerId, ownerId))).limit(1);
    if (!operation) throw new InventoryError("Choose an operation in your workspace.", 404);
  }
  const [ticket] = await db.insert(deliverySupport).values({
    ownerId, sourceApp: "delivery", operationId: data.operationId ?? null,
    subject: data.subject.trim(), message: data.message.trim(),
  }).returning();
  res.status(201).json(CreateDeliverySupportResponse.parse(supportView(ticket, [])));
});
router.post("/support/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new InventoryError("Support ticket not found.", 404);
  const parsed = CreateDeliverySupportMessageBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const message = parsed.data.message.trim();
  if (!message) throw new InventoryError("Write a message before sending it.");
  const ownerId = res.locals.deliveryUserId as string;
  const [ticket] = await db.select().from(deliverySupport).where(and(
    eq(deliverySupport.id, id),
    eq(deliverySupport.sourceApp, "delivery"),
    eq(deliverySupport.ownerId, ownerId),
  )).limit(1);
  if (!ticket) throw new InventoryError("Support ticket not found.", 404);
  const [created] = await db.insert(deliverySupportMessages).values({
    ticketId: id,
    senderRole: "customer",
    senderId: ownerId,
    message,
  }).returning();
  res.status(201).json(CreateDeliverySupportMessageResponse.parse({
    id: created.id,
    sender: created.senderRole,
    message: created.message,
    createdAt: created.createdAt?.toISOString() ?? null,
  }));
});
export default router;