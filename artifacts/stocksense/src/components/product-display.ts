export function unitLooksLikeQuantity(unit: string): boolean {
  return /^[\d.,\s]+$/.test(unit.trim());
}

export function formatSellingPrice(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'code',
  }).format(amount);
}