import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { rm } from "node:fs/promises";

const bundlePath = new URL("./.profile-contact.test-bundle.mjs", import.meta.url);
await build({
  stdin: { contents: 'export { SaveDeliveryProfileBody, SaveDeliveryRecipientBody, SetupDeliveryVoiceBody } from "@workspace/api-zod";', resolveDir: new URL(".", import.meta.url).pathname },
  outfile: bundlePath.pathname, bundle: true, platform: "node", format: "esm",
});
after(() => rm(bundlePath, { force: true }));
const { SaveDeliveryProfileBody, SaveDeliveryRecipientBody, SetupDeliveryVoiceBody } = await import(bundlePath.href);

for (const role of ["owner", "courier"]) {
  test(`${role} contact accepts exactly 10 digits and keeps them as text`, () => {
    const input = { name: "Synthetic tester", role, phone: "0123456789" };
    assert.deepEqual(SaveDeliveryProfileBody.parse(input), input);
  });
  test(`${role} contact rejects missing, short, long, non-digit, and country-code numbers`, () => {
    for (const phone of [undefined, "", "123456789", "12345678901", "+911234567890", "+1234567890", "12345 6789", "12345abcde", 1234567890]) {
      assert.equal(SaveDeliveryProfileBody.safeParse({ name: "Synthetic tester", role, phone }).success, false, String(phone));
    }
  });
}
test("account setup requires an explicit owner or courier role", () => {
  for (const role of [undefined, "", "support_staff", "administrator"]) {
    assert.equal(SaveDeliveryProfileBody.safeParse({ name: "Synthetic tester", phone: "1234567890", role }).success, false);
  }
});
test("customer/provider calling numbers still require E.164, not profile contact format", () => {
  assert.equal(SaveDeliveryRecipientBody.safeParse({ customerPhone: "1234567890", deliveryAddress: "Synthetic address" }).success, false);
  assert.equal(SaveDeliveryRecipientBody.safeParse({ customerPhone: "+911234567890", deliveryAddress: "Synthetic address" }).success, true);
  assert.equal(SetupDeliveryVoiceBody.safeParse({ fromNumber: "1234567890" }).success, false);
  assert.equal(SetupDeliveryVoiceBody.safeParse({ fromNumber: "+911234567890" }).success, true);
});