import { doublePrecision, integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const warehouses = pgTable(
  "inventory_warehouses",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address"),
  },
  (table) => [uniqueIndex("inventory_warehouses_owner_code").on(table.ownerId, table.code)],
);

export const locations = pgTable(
  "inventory_locations",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
    parentId: integer("parent_id"),
    name: text("name").notNull(),
    code: text("code").notNull(),
    kind: text("kind").notNull().default("internal"),
    address: text("address"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    googlePlaceId: text("google_place_id"),
  },
  (table) => [uniqueIndex("inventory_locations_owner_code").on(table.ownerId, table.code)],
);

export const insertWarehouseSchema = createInsertSchema(warehouses).omit({ id: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export type WarehouseRow = typeof warehouses.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type InsertLocation = z.infer<typeof insertLocationSchema>;