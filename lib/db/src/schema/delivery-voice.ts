import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const deliveryVoiceSettings = pgTable("delivery_app_voice_settings", {
  ownerId: text("owner_id").primaryKey(),
  fromNumber: text("from_number").notNull(),
  agentId: text("agent_id").notNull(),
  flowId: text("flow_id").notNull(),
});
export const insertDeliveryVoiceSettingsSchema = createInsertSchema(deliveryVoiceSettings);
export type DeliveryVoiceSettingsRow = typeof deliveryVoiceSettings.$inferSelect;