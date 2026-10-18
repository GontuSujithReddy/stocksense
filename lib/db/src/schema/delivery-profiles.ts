import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const deliveryProfiles = pgTable("delivery_app_profiles", {
  userId: text("user_id").primaryKey(),
  role: text("role").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertDeliveryProfileSchema = createInsertSchema(deliveryProfiles).omit({ createdAt: true });
export type DeliveryProfileRow = typeof deliveryProfiles.$inferSelect;