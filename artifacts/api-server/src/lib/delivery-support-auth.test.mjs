import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rm } from "node:fs/promises";
import { build } from "esbuild";

const bundlePath = new URL("./.delivery-support-auth.test-bundle.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./delivery-support-auth-core.ts", import.meta.url).pathname],
  outfile: bundlePath.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
});
after(async () => rm(bundlePath, { force: true }));

const { createDeliverySupportAuth, parseUserIdAllowlist } = await import(bundlePath.href);

function invoke(handler, userId) {
  const response = {
    locals: { deliveryUserId: userId },
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  return Promise.resolve(handler({}, response, () => { continued = true; })).then(() => ({ response, continued }));
}

test("administrator IDs are parsed as exact, trimmed values", () => {
  assert.deepEqual(parseUserIdAllowlist("admin-1, admin-2 ,, "), ["admin-1", "admin-2"]);
  assert.deepEqual(parseUserIdAllowlist(undefined), []);
});

test("staff authorization checks live membership on every protected request", async () => {
  const members = new Set(["staff-1"]);
  const auth = createDeliverySupportAuth({
    isAdministrator: userId => userId === "admin-1",
    hasStaffMembership: async userId => members.has(userId),
  });

  for (const userId of ["owner-1", "courier-1"]) {
    const { response, continued } = await invoke(auth.requireStaff, userId);
    assert.equal(response.statusCode, 403);
    assert.equal(continued, false);
  }

  assert.equal((await invoke(auth.requireStaff, "staff-1")).continued, true);
  members.delete("staff-1");
  const revoked = await invoke(auth.requireStaff, "staff-1");
  assert.equal(revoked.response.statusCode, 403);
  assert.equal(revoked.continued, false);

  assert.equal((await invoke(auth.requireStaff, "admin-1")).continued, true);
});

test("only an explicitly configured administrator can manage the staff roster", async () => {
  const auth = createDeliverySupportAuth({
    isAdministrator: userId => userId === "admin-1",
    hasStaffMembership: async userId => userId === "staff-1",
  });

  for (const userId of ["owner-1", "courier-1", "staff-1"]) {
    const { response, continued } = await invoke(auth.requireAdministrator, userId);
    assert.equal(response.statusCode, 403);
    assert.equal(continued, false);
  }
  assert.equal((await invoke(auth.requireAdministrator, "admin-1")).continued, true);
});