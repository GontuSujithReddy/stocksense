import { InventoryError } from "./inventory-error";

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export function currencyDigits(currency: string): number {
  if (!supportedCurrencies.has(currency)) {
    throw new InventoryError("Choose a supported currency code.", 400);
  }
  return new Intl.NumberFormat("en", { style: "currency", currency })
    .resolvedOptions().maximumFractionDigits ?? 2;
}

export function priceFields(
  sellingPrice: number | null | undefined,
  sellingPriceUsd: number | null | undefined,
  currencyCode: string | undefined,
  existingCurrency = "USD",
) {
  if (sellingPrice !== undefined && sellingPriceUsd !== undefined) {
    throw new InventoryError("Use either sellingPrice or sellingPriceUsd, not both.", 400);
  }
  if (sellingPriceUsd !== undefined && currencyCode && currencyCode !== "USD") {
    throw new InventoryError("A USD price cannot be saved with a different currency.", 400);
  }
  const currency = sellingPriceUsd !== undefined ? "USD" : currencyCode ?? existingCurrency;
  const digits = currencyDigits(currency);
  const amount = sellingPriceUsd !== undefined ? sellingPriceUsd : sellingPrice;
  if (amount === undefined) {
    if (currency !== existingCurrency) {
      throw new InventoryError("Enter a new price or clear it when changing currencies.", 400);
    }
    return { sellingPriceCurrency: currency };
  }
  if (amount === null) {
    return { sellingPriceCurrency: currency, sellingPriceMinor: null, sellingPriceCents: null };
  }
  const factor = 10 ** digits;
  const minor = Math.round(amount * factor);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000 ||
      minor > 2_147_483_647 || minor / factor !== amount) {
    throw new InventoryError(`Enter a ${currency} price from 0 to 1,000,000 with no more than ${digits} decimal places.`, 400);
  }
  return {
    sellingPriceCurrency: currency,
    // This new field always stores the currency's own smallest unit, not cents.
    sellingPriceMinor: minor,
    // Keep the old USD column in sync for existing integrations.
    sellingPriceCents: currency === "USD" ? minor : null,
  };
}