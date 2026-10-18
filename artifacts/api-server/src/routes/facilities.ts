import { and, eq, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, balances, inventoryWorkspaces, locations, operations, products, stockMoves, warehouses } from "@workspace/db";
import {
  ListWarehousesResponse,
  CreateWarehouseBody,
  CreateWarehouseResponse,
  UpdateWarehouseParams,
  UpdateWarehouseBody,
  UpdateWarehouseResponse,
  DeleteWarehouseParams,
  ListLocationsQueryParams,
  ListLocationsResponse,
  CreateLocationBody,
  CreateLocationResponse,
  UpdateLocationParams,
  UpdateLocationBody,
  UpdateLocationResponse,
  DeleteLocationParams,
  GetGooglePlacesConfigResponse,
  ListGooglePlaceSuggestionsQueryParams,
  ListGooglePlaceSuggestionsResponse,
  ResolveGooglePlaceBody,
  ResolveGooglePlaceResponse,
} from "@workspace/api-zod";
import { InventoryError } from "../lib/inventory-error";
import { googlePlacesEnabled, limitGoogleRequests, resolveGooglePin, resolveGooglePlace, suggestGooglePlaces } from "../lib/google-places";

const router: IRouter = Router();

async function warehouseById(ownerId: string, id: number) {
  const [warehouse] = await db.select().from(warehouses)
    .where(and(eq(warehouses.ownerId, ownerId), eq(warehouses.id, id))).limit(1);
  return warehouse;
}

async function locationById(ownerId: string, id: number) {
  const [location] = await db.select().from(locations)
    .where(and(eq(locations.ownerId, ownerId), eq(locations.id, id))).limit(1);
  return location;
}

async function requireValidParent(ownerId: string, parentId: number | null | undefined, warehouseId: number, selfId?: number) {
  if (parentId == null) return;
  if (parentId === selfId) throw new InventoryError("A location cannot be its own parent.");
  const parent = await locationById(ownerId, parentId);
  if (!parent || parent.warehouseId !== warehouseId) {
    throw new InventoryError("Choose a parent location in the same warehouse.");
  }
  // The location hierarchy is kept shallow so a parent cannot be a child of this location.
  if (selfId && parent.parentId === selfId) {
    throw new InventoryError("A location cannot be nested inside one of its children.");
  }
}

function validateCoordinatePair(latitude: number | null | undefined, longitude: number | null | undefined) {
  const hasLatitude = latitude !== undefined;
  const hasLongitude = longitude !== undefined;
  if (hasLatitude !== hasLongitude || (hasLatitude && (latitude === null) !== (longitude === null))) {
    throw new InventoryError("Latitude and longitude must be provided together or both be null.");
  }
}

router.get("/warehouses", async (_req, res): Promise<void> => {
  const ownerId = res.locals.ownerId as string;
  const [warehouseRows, locationRows] = await Promise.all([
    db.select().from(warehouses).where(eq(warehouses.ownerId, ownerId)),
    db.select().from(locations).where(eq(locations.ownerId, ownerId)),
  ]);
  res.json(ListWarehousesResponse.parse(warehouseRows.map((warehouse) => ({
    ...warehouse,
    locationCount: locationRows.filter((location) => location.warehouseId === warehouse.id).length,
  }))));
});

router.post("/warehouses", async (req, res): Promise<void> => {
  const parsed = CreateWarehouseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [warehouse] = await db.insert(warehouses).values({
    ownerId: res.locals.ownerId,
    name: parsed.data.name.trim(),
    code: parsed.data.code.trim().toUpperCase(),
    address: parsed.data.address ?? null,
  }).returning();
  res.status(201).json(CreateWarehouseResponse.parse({ ...warehouse, locationCount: 0 }));
});

router.patch("/warehouses/:id", async (req, res): Promise<void> => {
  const params = UpdateWarehouseParams.safeParse(req.params);
  const parsed = UpdateWarehouseBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request." });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const [warehouse] = await db.update(warehouses).set({
    ...parsed.data,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.code !== undefined ? { code: parsed.data.code.trim().toUpperCase() } : {}),
  }).where(and(eq(warehouses.ownerId, ownerId), eq(warehouses.id, params.data.id))).returning();
  if (!warehouse) {
    res.status(404).json({ error: "Warehouse not found." });
    return;
  }
  const locationRows = await db.select({ id: locations.id }).from(locations)
    .where(and(eq(locations.ownerId, ownerId), eq(locations.warehouseId, warehouse.id)));
  res.json(UpdateWarehouseResponse.parse({ ...warehouse, locationCount: locationRows.length }));
});

router.delete("/warehouses/:id", async (req, res): Promise<void> => {
  const params = DeleteWarehouseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const locationRows = await db.select({ id: locations.id }).from(locations)
    .where(and(eq(locations.ownerId, ownerId), eq(locations.warehouseId, params.data.id))).limit(1);
  if (locationRows.length) {
    res.status(409).json({ error: "Remove this warehouse's locations first." });
    return;
  }
  const [deleted] = await db.delete(warehouses)
    .where(and(eq(warehouses.ownerId, ownerId), eq(warehouses.id, params.data.id)))
    .returning({ id: warehouses.id });
  if (!deleted) {
    res.status(404).json({ error: "Warehouse not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/locations", async (req, res): Promise<void> => {
  const parsed = ListLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const [locationRows, warehouseRows] = await Promise.all([
    db.select().from(locations).where(eq(locations.ownerId, ownerId)),
    db.select().from(warehouses).where(eq(warehouses.ownerId, ownerId)),
  ]);
  const warehouseById = new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse]));
  res.json(ListLocationsResponse.parse(locationRows
    .filter((location) => !parsed.data.warehouseId || location.warehouseId === parsed.data.warehouseId)
    .map((location) => ({
      ...location,
      warehouseName: warehouseById.get(location.warehouseId)?.name ?? "",
    }))));
});

router.get("/google-places/config", (_req, res): void => {
  res.json(GetGooglePlacesConfigResponse.parse({
    enabled: googlePlacesEnabled(),
    browserKey: googlePlacesEnabled() ? process.env.GOOGLE_MAPS_BROWSER_KEY : null,
  }));
});

router.get("/google-places/suggestions", async (req, res): Promise<void> => {
  const parsed = ListGooglePlaceSuggestionsQueryParams.safeParse(req.query);
  if (!parsed.success || parsed.data.query.trim().length < 3) { res.status(400).json({ error: "Enter at least three characters (up to 120) to search." }); return; }
  limitGoogleRequests(res.locals.ownerId as string);
  res.json(ListGooglePlaceSuggestionsResponse.parse(await suggestGooglePlaces(parsed.data.query.trim())));
});

router.post("/google-places/resolve", async (req, res): Promise<void> => {
  const parsed = ResolveGooglePlaceBody.safeParse(req.body);
  if (!parsed.success || Number(Boolean(parsed.data?.placeId)) + Number(Boolean(parsed.data?.pin)) !== 1) {
    res.status(400).json({ error: "Choose either a Google place or a pin." });
    return;
  }
  limitGoogleRequests(res.locals.ownerId as string);
  const place = parsed.data.placeId
    ? await resolveGooglePlace(parsed.data.placeId)
    : await resolveGooglePin(parsed.data.pin!);
  res.json(ResolveGooglePlaceResponse.parse(place));
});

router.post("/locations", async (req, res): Promise<void> => {
  const parsed = CreateLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  validateCoordinatePair(parsed.data.latitude, parsed.data.longitude);
  if (parsed.data.googlePlaceId && parsed.data.googlePin) throw new InventoryError("Choose either a Google place or a map pin.");
  const ownerId = res.locals.ownerId as string;
  const warehouse = await warehouseById(ownerId, parsed.data.warehouseId);
  if (!warehouse) throw new InventoryError("Choose a warehouse in your inventory.");
  await requireValidParent(ownerId, parsed.data.parentId, warehouse.id);
  // Never trust a client-supplied address/coordinates for a Google selection.
  if (parsed.data.googlePlaceId || parsed.data.googlePin) limitGoogleRequests(ownerId);
  const googlePlace = parsed.data.googlePlaceId
    ? await resolveGooglePlace(parsed.data.googlePlaceId)
    : parsed.data.googlePin ? await resolveGooglePin(parsed.data.googlePin) : null;
  const [location] = await db.insert(locations).values({
    ownerId,
    name: parsed.data.name.trim(),
    code: parsed.data.code.trim().toUpperCase(),
    warehouseId: warehouse.id,
    parentId: parsed.data.parentId ?? null,
    kind: parsed.data.kind,
    address: googlePlace?.address ?? parsed.data.address?.trim() ?? null,
    latitude: googlePlace?.latitude ?? parsed.data.latitude ?? null,
    longitude: googlePlace?.longitude ?? parsed.data.longitude ?? null,
    googlePlaceId: googlePlace?.placeId ?? null,
  }).returning();
  res.status(201).json(CreateLocationResponse.parse({ ...location, warehouseName: warehouse.name }));
});

router.patch("/locations/:id", async (req, res): Promise<void> => {
  const params = UpdateLocationParams.safeParse(req.params);
  const parsed = UpdateLocationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request." });
    return;
  }
  validateCoordinatePair(parsed.data.latitude, parsed.data.longitude);
  const ownerId = res.locals.ownerId as string;
  const existing = await locationById(ownerId, params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  await requireValidParent(ownerId, parsed.data.parentId, existing.warehouseId, existing.id);
  const addressChanged = parsed.data.address !== undefined && (parsed.data.address?.trim() ?? null) !== existing.address;
  const coordinatesChanged = (parsed.data.latitude !== undefined && parsed.data.latitude !== existing.latitude)
    || (parsed.data.longitude !== undefined && parsed.data.longitude !== existing.longitude);
  const [location] = await db.update(locations).set({
    ...parsed.data,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.code !== undefined ? { code: parsed.data.code.trim().toUpperCase() } : {}),
    ...(parsed.data.address !== undefined ? { address: parsed.data.address?.trim() ?? null } : {}),
    ...(addressChanged && parsed.data.latitude === undefined ? { latitude: null, longitude: null } : {}),
    ...(addressChanged || coordinatesChanged ? { googlePlaceId: null } : {}),
  }).where(and(eq(locations.ownerId, ownerId), eq(locations.id, existing.id))).returning();
  const warehouse = await warehouseById(ownerId, existing.warehouseId);
  res.json(UpdateLocationResponse.parse({ ...location, warehouseName: warehouse?.name ?? "" }));
});

router.delete("/locations/:id", async (req, res): Promise<void> => {
  const params = DeleteLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const id = params.data.id;
  const [stock, child, operation, defaultProduct, stockHistory, storefront] = await Promise.all([
    db.select({ id: balances.id }).from(balances).where(and(eq(balances.ownerId, ownerId), eq(balances.locationId, id))).limit(1),
    db.select({ id: locations.id }).from(locations).where(and(eq(locations.ownerId, ownerId), eq(locations.parentId, id))).limit(1),
    db.select({ id: operations.id }).from(operations).where(and(eq(operations.ownerId, ownerId), or(eq(operations.sourceLocationId, id), eq(operations.destinationLocationId, id)))).limit(1),
    db.select({ id: products.id }).from(products).where(and(
      eq(products.ownerId, ownerId),
      eq(products.defaultLocationId, id),
      eq(products.active, true),
    )).limit(1),
    db.select({ id: stockMoves.id }).from(stockMoves).where(and(
      eq(stockMoves.ownerId, ownerId),
      or(eq(stockMoves.sourceLocationId, id), eq(stockMoves.destinationLocationId, id)),
    )).limit(1),
    db.select({ ownerId: inventoryWorkspaces.ownerId }).from(inventoryWorkspaces)
      .where(and(
        eq(inventoryWorkspaces.ownerId, ownerId),
        eq(inventoryWorkspaces.storefrontLocationId, id),
      )).limit(1),
  ]);
  if (storefront.length) {
    res.status(409).json({ error: "This location is selected for your storefront. Choose another location or clear it in Overview before deleting it." });
    return;
  }
  if (stockHistory.length) {
    res.status(409).json({ error: "This location has stock history and cannot be deleted." });
    return;
  }
  if (stock.length || child.length || operation.length || defaultProduct.length) {
    res.status(409).json({ error: "This location is used by stock, another location, an operation, or an active product's default location." });
    return;
  }
  const [deleted] = await db.delete(locations)
    .where(and(eq(locations.ownerId, ownerId), eq(locations.id, id)))
    .returning({ id: locations.id });
  if (!deleted) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;