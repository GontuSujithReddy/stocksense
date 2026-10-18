import { and, eq } from "drizzle-orm";
import {
  balances,
  categories,
  db,
  inventoryWorkspaces,
  locations,
  operationLines,
  operations,
  products,
  stockMoves,
  warehouses,
} from "@workspace/db";

type WorkspaceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type DemoProductDefinition = {
  key: string;
  name: string;
  sku: string;
  unit: string;
  reorderPoint: number;
  priceMinor: number;
  openingQuantity: number;
};

const demoProductDefinitions: DemoProductDefinition[] = [
  {
    key: "coffee",
    name: "Demo · Espresso beans",
    sku: "DEMO-ESPRESSO",
    unit: "bags",
    reorderPoint: 6,
    priceMinor: 1699,
    openingQuantity: 16,
  },
  {
    key: "granola",
    name: "Demo · House granola",
    sku: "DEMO-GRANOLA",
    unit: "boxes",
    reorderPoint: 6,
    priceMinor: 875,
    openingQuantity: 4,
  },
  {
    key: "tea",
    name: "Demo · Green tea",
    sku: "DEMO-GREEN-TEA",
    unit: "tins",
    reorderPoint: 5,
    priceMinor: 725,
    openingQuantity: 12,
  },
];

function nextUniqueValue(base: string, usedValues: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (usedValues.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedValues.add(candidate);
  return candidate;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function seedInventoryDemoData(
  tx: WorkspaceTransaction,
  ownerId: string,
  workspace: {
    storefrontSlug: string | null;
    storefrontLocationId: number | null;
    storefrontDraftDesign: unknown;
    storefrontPublishedDesign: unknown;
  },
): Promise<void> {
  const existingCategoryNames = await tx.select({ name: categories.name })
    .from(categories).where(eq(categories.ownerId, ownerId));
  const existingWarehouseCodes = await tx.select({ code: warehouses.code })
    .from(warehouses).where(eq(warehouses.ownerId, ownerId));
  const existingLocationCodes = await tx.select({ code: locations.code })
    .from(locations).where(eq(locations.ownerId, ownerId));
  const existingSkus = await tx.select({ sku: products.sku }).from(products).where(and(
    eq(products.ownerId, ownerId),
    eq(products.active, true),
  ));
  const existingReferences = await tx.select({ reference: operations.reference })
    .from(operations).where(eq(operations.ownerId, ownerId));

  const categoryName = nextUniqueValue(
    "Demo products",
    new Set(existingCategoryNames.map((row) => row.name)),
  );
  const warehouseCode = nextUniqueValue(
    "DEMO-WH",
    new Set(existingWarehouseCodes.map((row) => row.code)),
  );
  const backroomCode = nextUniqueValue(
    "DEMO-BACK",
    new Set(existingLocationCodes.map((row) => row.code)),
  );
  const displayCode = nextUniqueValue(
    "DEMO-DISPLAY",
    new Set([...existingLocationCodes.map((row) => row.code), backroomCode]),
  );
  const usedSkus = new Set(existingSkus.map((row) => row.sku));
  const productSkus = new Map(
    demoProductDefinitions.map((definition) => [
      definition.key,
      nextUniqueValue(definition.sku, usedSkus),
    ]),
  );
  const usedReferences = new Set(existingReferences.map((row) => row.reference));
  const receiptReference = nextUniqueValue("DEMO-STARTER-RECEIPT", usedReferences);
  const transferReference = nextUniqueValue("DEMO-STARTER-TRANSFER", usedReferences);
  const requestReference = nextUniqueValue("DEMO-STOREFRONT-REQUEST", usedReferences);

  const [category] = await tx.insert(categories).values({
    ownerId,
    name: categoryName,
    color: "#557d70",
  }).returning({ id: categories.id });
  const [warehouse] = await tx.insert(warehouses).values({
    ownerId,
    name: "Demo warehouse",
    code: warehouseCode,
    address: null,
  }).returning({ id: warehouses.id });
  const [backroom] = await tx.insert(locations).values({
    ownerId,
    warehouseId: warehouse.id,
    parentId: null,
    name: "Demo backroom",
    code: backroomCode,
    kind: "internal",
    address: null,
  }).returning({ id: locations.id });
  const [display] = await tx.insert(locations).values({
    ownerId,
    warehouseId: warehouse.id,
    parentId: null,
    name: "Demo display shelf",
    code: displayCode,
    kind: "internal",
    address: null,
  }).returning({ id: locations.id });

  const createdProducts = await tx.insert(products).values(demoProductDefinitions.map((definition) => ({
    ownerId,
    name: definition.name,
    sku: productSkus.get(definition.key)!,
    categoryId: category.id,
    defaultLocationId: backroom.id,
    unit: definition.unit,
    reorderPoint: definition.reorderPoint,
    sellingPriceMinor: definition.priceMinor,
    sellingPriceCurrency: "USD",
    active: true,
  }))).returning({ id: products.id, sku: products.sku });
  const productIds = new Map(createdProducts.map((product) => [
    demoProductDefinitions.find((definition) => productSkus.get(definition.key) === product.sku)!.key,
    product.id,
  ]));

  const now = new Date();
  const receiptDate = daysBefore(now, 14);
  const [receipt] = await tx.insert(operations).values({
    ownerId,
    reference: receiptReference,
    type: "receipt",
    origin: "inventory",
    status: "done",
    contact: "Demo opening stock",
    destinationLocationId: backroom.id,
    createdAt: receiptDate,
  }).returning({ id: operations.id });
  await tx.insert(operationLines).values(demoProductDefinitions.map((definition) => ({
    ownerId,
    operationId: receipt.id,
    productId: productIds.get(definition.key)!,
    quantity: definition.openingQuantity,
    countedQuantity: null,
    unitPriceMinor: definition.priceMinor,
    unitPriceCurrency: "USD",
  })));
  await tx.insert(stockMoves).values(demoProductDefinitions.map((definition) => ({
    ownerId,
    operationId: receipt.id,
    productId: productIds.get(definition.key)!,
    type: "receipt",
    reference: receiptReference,
    sourceLocationId: null,
    destinationLocationId: backroom.id,
    quantity: definition.openingQuantity,
    movedAt: receiptDate,
  })));

  const coffeeId = productIds.get("coffee")!;
  const coffee = demoProductDefinitions.find((definition) => definition.key === "coffee")!;
  const transferDate = daysBefore(now, 5);
  const [transfer] = await tx.insert(operations).values({
    ownerId,
    reference: transferReference,
    type: "transfer",
    origin: "inventory",
    status: "done",
    contact: "Demo stock transfer",
    sourceLocationId: backroom.id,
    destinationLocationId: display.id,
    createdAt: transferDate,
  }).returning({ id: operations.id });
  await tx.insert(operationLines).values({
    ownerId,
    operationId: transfer.id,
    productId: coffeeId,
    quantity: 5,
    countedQuantity: null,
    unitPriceMinor: coffee.priceMinor,
    unitPriceCurrency: "USD",
  });
  await tx.insert(stockMoves).values({
    ownerId,
    operationId: transfer.id,
    productId: coffeeId,
    type: "transfer",
    reference: transferReference,
    sourceLocationId: backroom.id,
    destinationLocationId: display.id,
    quantity: 5,
    movedAt: transferDate,
  });

  await tx.insert(balances).values([
    {
      ownerId,
      productId: coffeeId,
      locationId: backroom.id,
      quantity: coffee.openingQuantity - 5,
    },
    {
      ownerId,
      productId: coffeeId,
      locationId: display.id,
      quantity: 5,
    },
    ...demoProductDefinitions
      .filter((definition) => definition.key !== "coffee")
      .map((definition) => ({
        ownerId,
        productId: productIds.get(definition.key)!,
        locationId: backroom.id,
        quantity: definition.openingQuantity,
      })),
  ]);

  const requestDate = daysBefore(now, 2);
  const [sampleRequest] = await tx.insert(operations).values({
    ownerId,
    reference: requestReference,
    type: "delivery",
    origin: "storefront",
    status: "canceled",
    contact: "Demo shopper · Casey",
    customerEmail: "demo.customer@example.invalid",
    sourceLocationId: backroom.id,
    createdAt: requestDate,
  }).returning({ id: operations.id });
  await tx.insert(operationLines).values([
    {
      ownerId,
      operationId: sampleRequest.id,
      productId: coffeeId,
      quantity: 1,
      countedQuantity: null,
      unitPriceMinor: coffee.priceMinor,
      unitPriceCurrency: "USD",
    },
    {
      ownerId,
      operationId: sampleRequest.id,
      productId: productIds.get("tea")!,
      quantity: 2,
      countedQuantity: null,
      unitPriceMinor: demoProductDefinitions.find((definition) => definition.key === "tea")!.priceMinor,
      unitPriceCurrency: "USD",
    },
  ]);

  if (
    workspace.storefrontSlug === null &&
    workspace.storefrontLocationId === null &&
    workspace.storefrontDraftDesign === null &&
    workspace.storefrontPublishedDesign === null
  ) {
    await tx.update(inventoryWorkspaces).set({
      storefrontLocationId: backroom.id,
      storefrontDraftDesign: {
        storeName: "Demo Market",
        tagline: "A sample storefront to explore",
        description: "Review the clearly labeled sample catalog and edit this draft before publishing.",
        theme: "evergreen",
        layout: "catalog",
        heroImageAssetId: null,
        heroImageFit: { x: 0.5, y: 0.5, zoom: 1 },
      },
    }).where(eq(inventoryWorkspaces.ownerId, ownerId));
  }
}
