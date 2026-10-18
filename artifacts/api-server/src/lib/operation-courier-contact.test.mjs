import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { rm } from "node:fs/promises";

const bundlePath = new URL("./.operation-courier-contact.test-bundle.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./inventory-queries.ts", import.meta.url).pathname],
  outfile: bundlePath.pathname, bundle: true, platform: "node", format: "esm", packages: "external",
  plugins: [{
    name: "isolated-courier-records",
    setup(b) {
      b.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$/ }, args => ({ path: args.path, namespace: "contact-mock" }));
      b.onLoad({ filter: /.*/, namespace: "contact-mock" }, ({ path }) => ({
        contents: path === "drizzle-orm"
          ? "export const eq = (key,value) => row => row[key] === value; export const inArray = (key,values) => row => values.includes(row[key]); export const and = (...predicates) => row => predicates.every(p => p(row));"
          : `const table = name => ({name, ownerId:"ownerId", userId:"userId", role:"role"});
             export const operations=table("operations"),operationLines=table("operationLines"),products=table("products"),locations=table("locations"),deliveryProfiles=table("profiles"),categories=table("categories"),warehouses=table("warehouses"),balances=table("balances"),stockMoves=table("stockMoves");
             export const db = {select: () => ({from: t => ({where: predicate => Promise.resolve((globalThis.__contactFixtures[t.name] ?? []).filter(predicate))})})};`,
      }));
    },
  }],
});
after(() => rm(bundlePath, { force: true }));
after(() => { delete globalThis.__contactFixtures; });
const { enrichedOperations } = await import(bundlePath.href);
const operation = (id, ownerId, courierUserId) => ({
  id, ownerId, courierUserId, courierEmail: courierUserId ? "courier@example.invalid" : null,
  reference: `Synthetic-${id}`, type: "delivery", status: "draft", contact: null,
  sourceLocationId: null, destinationLocationId: null, scheduledAt: null,
  deliveryStartedAt: null, deliveryCompletedAt: null, createdAt: new Date("2026-10-02T00:00:00Z"),
});
test("operation contact belongs to its assigned courier and only the requested owner's operations", async () => {
  globalThis.__contactFixtures = {
    operations: [operation(1, "owner-a", "courier-a"), operation(2, "owner-b", "courier-b"), operation(3, "owner-a", null)],
    profiles: [
      { userId: "courier-a", role: "courier", name: "Courier A", phone: "1234567890" },
      { userId: "courier-b", role: "courier", name: "Courier B", phone: "0987654321" },
      { userId: "unassigned", role: "courier", name: "Not assigned", phone: "1111111111" },
    ],
  };
  const rows = await enrichedOperations("owner-a");
  assert.deepEqual(rows.map(row => row.id), [3, 1]);
  assert.equal(rows[1].courierName, "Courier A");
  assert.equal(rows[1].courierPhone, "1234567890");
  assert.equal(rows[0].courierPhone, null);
  assert.ok(!JSON.stringify(rows).includes("0987654321"));
});
test("updated contacts appear on reread; removing/reassigning clears the old courier phone", async () => {
  globalThis.__contactFixtures = {
    operations: [operation(1, "owner-a", "courier-a")],
    profiles: [
      { userId: "courier-a", role: "courier", name: "Courier A", phone: "1234567890" },
      { userId: "courier-b", role: "courier", name: "Courier B", phone: "0987654321" },
    ],
  };
  globalThis.__contactFixtures.profiles[0].phone = "2222222222";
  assert.equal((await enrichedOperations("owner-a"))[0].courierPhone, "2222222222");
  globalThis.__contactFixtures.operations[0] = operation(1, "owner-a", "courier-b");
  assert.equal((await enrichedOperations("owner-a"))[0].courierPhone, "0987654321");
  globalThis.__contactFixtures.operations[0] = operation(1, "owner-a", null);
  assert.equal((await enrichedOperations("owner-a"))[0].courierPhone, null);
});