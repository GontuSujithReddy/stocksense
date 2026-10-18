import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { rm } from "node:fs/promises";

const bundlePath = new URL("./.stocksense-admin-state.test-bundle.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./stocksense-admin-state.ts", import.meta.url).pathname],
  outfile: bundlePath.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
});
after(() => rm(bundlePath, { force: true }));
const {
  stocksenseAdminAccessUnavailableStatus,
  stocksenseAdminAccountCounts,
  stocksenseAdminCanReviewSupportAccess,
  stocksenseAdminRole,
} = await import(bundlePath.href);

test("accepted count overlaps active and inactive, but excludes terminated", () => {
  const counts = stocksenseAdminAccountCounts([
    { requestStatus: "pending", accessStatus: null },
    { requestStatus: "denied", accessStatus: null },
    { requestStatus: "accepted", accessStatus: "active" },
    { requestStatus: "accepted", accessStatus: "active" },
    { requestStatus: "accepted", accessStatus: "inactive" },
    { requestStatus: "accepted", accessStatus: "terminated" },
  ]);
  assert.deepEqual(counts, {
    pending: 1,
    accepted: 3,
    denied: 1,
    active: 2,
    inactive: 1,
    terminated: 1,
  });
});

test("only active accepted Admin accounts receive the Owner role", () => {
  assert.equal(stocksenseAdminRole("pending", null), null);
  assert.equal(stocksenseAdminRole("accepted", "active"), "owner");
  assert.equal(stocksenseAdminRole("accepted", "inactive"), null);
  assert.equal(stocksenseAdminRole("accepted", "terminated"), null);
  assert.equal(stocksenseAdminRole("denied", null), undefined);
});

test("inactive and terminated accepted Admin accounts are identified for portal blocking", () => {
  assert.equal(stocksenseAdminAccessUnavailableStatus("accepted", "active"), null);
  assert.equal(stocksenseAdminAccessUnavailableStatus("accepted", "inactive"), "inactive");
  assert.equal(stocksenseAdminAccessUnavailableStatus("accepted", "terminated"), "terminated");
  assert.equal(stocksenseAdminAccessUnavailableStatus("accepted", null), "inactive");
  assert.equal(stocksenseAdminAccessUnavailableStatus("pending", null), null);
  assert.equal(stocksenseAdminAccessUnavailableStatus("denied", null), null);
});

test("only active, accepted Admin accounts can review support access", () => {
  assert.equal(stocksenseAdminCanReviewSupportAccess("accepted", "active"), true);
  assert.equal(stocksenseAdminCanReviewSupportAccess("pending", "active"), false);
  assert.equal(stocksenseAdminCanReviewSupportAccess("denied", "active"), false);
  assert.equal(stocksenseAdminCanReviewSupportAccess("accepted", "inactive"), false);
  assert.equal(stocksenseAdminCanReviewSupportAccess("accepted", "terminated"), false);
  assert.equal(stocksenseAdminCanReviewSupportAccess("accepted", null), false);
});