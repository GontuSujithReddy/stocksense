import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { products } from "./catalog";
import { locations } from "./facilities";

export const balances = pgTable(
  "inventory_balances",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    productId: integer("product_id").notNull().references(() => products.id),
    locationId: integer("location_id").notNull().references(() => locations.id),
    quantity: doublePrecision("quantity").notNull().default(0),
  },
  (table) => [
    uniqueIndex("inventory_balances_owner_product_location").on(
      table.ownerId,
      table.productId,
      table.locationId,
    ),
  ],
);

export const operations = pgTable("inventory_operations", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  reference: text("reference").notNull().default(""),
  type: text("type").notNull(),
  origin: text("origin").notNull().default("inventory"),
  status: text("status").notNull().default("draft"),
  contact: text("contact"),
  customerEmail: text("customer_email"),
  sourceLocationId: integer("source_location_id").references(() => locations.id),
  destinationLocationId: integer("destination_location_id").references(() => locations.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  courierUserId: text("courier_user_id"),
  courierEmail: text("courier_email"),
  deliveryStartedAt: timestamp("delivery_started_at", { withTimezone: true }),
  deliveryReachedAt: timestamp("delivery_reached_at", { withTimezone: true }),
  deliveryCompletedAt: timestamp("delivery_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const operationLines = pgTable("inventory_operation_lines", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  operationId: integer("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: doublePrecision("quantity").notNull().default(0),
  countedQuantity: doublePrecision("counted_quantity"),
  unitPriceMinor: integer("unit_price_minor"),
  unitPriceCurrency: text("unit_price_currency"),
});

export const stockMoves = pgTable("inventory_stock_moves", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  operationId: integer("operation_id").references(() => operations.id),
  productId: integer("product_id").notNull().references(() => products.id),
  type: text("type").notNull(),
  reference: text("reference").notNull(),
  sourceLocationId: integer("source_location_id").references(() => locations.id),
  destinationLocationId: integer("destination_location_id").references(() => locations.id),
  quantity: doublePrecision("quantity").notNull(),
  movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBalanceSchema = createInsertSchema(balances).omit({ id: true });
export const insertOperationSchema = createInsertSchema(operations).omit({ id: true, createdAt: true, origin: true, courierUserId: true, courierEmail: true, deliveryStartedAt: true, deliveryReachedAt: true, deliveryCompletedAt: true });
export const insertOperationLineSchema = createInsertSchema(operationLines).omit({ id: true });
export const insertStockMoveSchema = createInsertSchema(stockMoves).omit({ id: true, movedAt: true });
export type BalanceRow = typeof balances.$inferSelect;
export type OperationRow = typeof operations.$inferSelect;
export type OperationLineRow = typeof operationLines.$inferSelect;
export type StockMoveRow = typeof stockMoves.$inferSelect;
export type InsertBalance = z.infer<typeof insertBalanceSchema>;