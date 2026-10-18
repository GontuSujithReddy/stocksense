import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeliveryChatToken,
  createDeliveryOtp,
  deliveryOtpMatches,
  hashDeliveryChatToken,
  hashDeliveryOtp,
  maskCustomerEmail,
} from "./delivery-otp.ts";

test("delivery OTPs are six digits and bind to the delivery id", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "delivery-otp-test-secret";
  try {
    const otp = createDeliveryOtp();
    const hash = hashDeliveryOtp(41, otp);
    assert.match(otp, /^[0-9]{6}$/);
    assert.equal(deliveryOtpMatches(41, otp, hash), true);
    assert.equal(deliveryOtpMatches(42, otp, hash), false);
    assert.equal(deliveryOtpMatches(41, "000000", hash), otp === "000000");
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("delivery chat tokens are opaque, URL-safe, and stored as a digest", () => {
  const token = createDeliveryChatToken();
  const digest = hashDeliveryChatToken(token);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(hashDeliveryChatToken(token), digest);
});

test("customer email masking does not expose the full local part", () => {
  assert.equal(maskCustomerEmail("customer@example.com"), "c******@example.com");
  assert.equal(maskCustomerEmail(null), null);
  assert.equal(maskCustomerEmail("not-an-email"), null);
});
