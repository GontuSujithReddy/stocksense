import { createHash } from "node:crypto";

export function stocksenseMemoryBankId(ownerId: string): string {
  return `stocksense-${createHash("sha256").update(ownerId).digest("hex")}`;
}