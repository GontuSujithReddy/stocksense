import { InventoryError } from "./inventory-error";

export type Pin = { latitude: number; longitude: number };
export type GooglePlace = Pin & { placeId: string; address: string };

const requests = new Map<string, number[]>();
const LIMIT = 30;
const WINDOW_MS = 60_000;

export function googlePlacesEnabled() {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY && process.env.GOOGLE_MAPS_BROWSER_KEY);
}

export function limitGoogleRequests(ownerId: string) {
  const now = Date.now();
  if (requests.size > 500) {
    for (const [id, entries] of requests) {
      if (entries.at(-1)! < now - WINDOW_MS) requests.delete(id);
    }
  }
  const entries = (requests.get(ownerId) ?? []).filter(time => time > now - WINDOW_MS);
  if (entries.length >= LIMIT) throw new InventoryError("Google place limit reached (30 lookups per minute). Try again in a minute.", 429);
  entries.push(now);
  requests.set(ownerId, entries);
}

async function googleRequest<T>(url: string, options?: { body: unknown; fieldMask?: string }): Promise<T> {
  if (!googlePlacesEnabled()) throw new InventoryError("Google place picking is not configured. You can still enter an address manually.", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: options ? "POST" : "GET",
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_MAPS_SERVER_KEY!,
        ...(options?.fieldMask ? { "X-Goog-FieldMask": options.fieldMask } : {}),
        ...(options ? { "Content-Type": "application/json" } : {}),
      },
      ...(options ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    if (response.status === 429) throw new InventoryError("Google Maps has reached its usage limit. Try again later or enter an address manually.", 429);
    if (response.status === 403 || response.status === 401) throw new InventoryError("Google Maps access was denied. Check that Places API (New) and Geocoding API are enabled and billing and key restrictions are correct.", 503);
    if (response.status === 404) throw new InventoryError("Google place no longer exists. Search again.", 422);
    if (!response.ok) throw new InventoryError("Google Maps could not complete this lookup. Try again or enter an address manually.", 502);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError("Google Maps did not respond. Try again or enter an address manually.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function suggestGooglePlaces(input: string) {
  const result = await googleRequest<{
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  }>("https://places.googleapis.com/v1/places:autocomplete", {
    body: { input },
    fieldMask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
  });
  return (result.suggestions ?? []).flatMap(({ placePrediction }) =>
    placePrediction?.placeId && placePrediction.text?.text
      ? [{ placeId: placePrediction.placeId, text: placePrediction.text.text }]
      : []);
}

export async function resolveGooglePlace(placeId: string): Promise<GooglePlace> {
  // Google IDs must not be allowed to alter the URL path.
  const result = await googleRequest<{ id?: string; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }>(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=id,formattedAddress,location`,
  );
  if (!result.id || !result.formattedAddress || !Number.isFinite(result.location?.latitude) || !Number.isFinite(result.location?.longitude)) {
    throw new InventoryError("This Google place has no usable address or pin. Choose another place.", 422);
  }
  return { placeId: result.id, address: result.formattedAddress, latitude: result.location!.latitude!, longitude: result.location!.longitude! };
}

export async function resolveGooglePin(pin: Pin): Promise<GooglePlace> {
  const result = await googleRequest<{ results?: { place_id?: string; formatted_address?: string }[]; status?: string }>(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${pin.latitude},${pin.longitude}&key=${encodeURIComponent(process.env.GOOGLE_MAPS_SERVER_KEY!)}`,
  );
  if (result.status === "OVER_QUERY_LIMIT") throw new InventoryError("Google Maps has reached its usage limit. Try again later.", 429);
  if (result.status === "REQUEST_DENIED") throw new InventoryError("Google Geocoding access was denied. Check API access, billing and key restrictions.", 503);
  const first = result.results?.[0];
  if (!first?.place_id || !first.formatted_address) throw new InventoryError("No Google address was found at this pin. Choose another point.", 422);
  return { placeId: first.place_id, address: first.formatted_address, ...pin };
}