import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { locations } from "./facilities";

export type ImageFit = {
  x: number;
  y: number;
  zoom: number;
};

export type StorefrontDesign = {
  storeName: string;
  tagline: string;
  description: string;
  theme: "evergreen" | "ocean" | "sunrise";
  layout: "showcase" | "catalog" | "editorial";
  heroImageAssetId: number | null;
  heroImageFit?: ImageFit;
};

export const storefrontAssets = pgTable(
  "storefront_assets",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("storefront_assets_object_path").on(table.objectPath)],
);

export const inventoryWorkspaces = pgTable("inventory_workspaces", {
  ownerId: text("owner_id").primaryKey(),
  storefrontSlug: text("storefront_slug"),
  storefrontLocationId: integer("storefront_location_id").references(() => locations.id, { onDelete: "set null" }),
  storefrontDraftDesign: jsonb("storefront_draft_design").$type<StorefrontDesign | null>(),
  storefrontPublishedDesign: jsonb("storefront_published_design").$type<StorefrontDesign | null>(),
  storefrontCreatedAt: timestamp("storefront_created_at", { withTimezone: true }),
  demoDataSeededAt: timestamp("demo_data_seeded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [uniqueIndex("inventory_workspaces_storefront_slug").on(table.storefrontSlug)]);

export const categories = pgTable(
  "inventory_categories",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#467B68"),
  },
  (table) => [uniqueIndex("inventory_categories_owner_name").on(table.ownerId, table.name)],
);

export const products = pgTable(
  "inventory_products",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    defaultLocationId: integer("default_location_id").references(() => locations.id, { onDelete: "set null" }),
    imageAssetId: integer("image_asset_id").references(() => storefrontAssets.id, { onDelete: "set null" }),
    imageFit: jsonb("image_fit").$type<ImageFit>().notNull().default(sql`'{"x":0.5,"y":0.5,"zoom":1}'::jsonb`),
    unit: text("unit").notNull(),
    reorderPoint: doublePrecision("reorder_point").notNull().default(0),
    sellingPriceCents: integer("selling_price_cents"),
    sellingPriceMinor: integer("selling_price_minor"),
    sellingPriceCurrency: text("selling_price_currency").notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("inventory_products_owner_active_sku").on(table.ownerId, table.sku).where(sql`${table.active} = true`)],
);

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export type CategoryRow = typeof categories.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;