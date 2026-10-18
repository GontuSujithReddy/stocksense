import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const stocksenseSupportProfiles = pgTable("stocksense_support_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  verifiedEmail: text("verified_email").notNull(),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

export const insertStocksenseSupportProfileSchema = createInsertSchema(stocksenseSupportProfiles)
  .omit({ createdAt: true, updatedAt: true });

export type StocksenseSupportProfile = typeof stocksenseSupportProfiles.$inferSelect;
export type InsertStocksenseSupportProfile = typeof stocksenseSupportProfiles.$inferInsert;