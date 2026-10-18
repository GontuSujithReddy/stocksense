import assert from 'node:assert/strict';
import { test } from 'node:test';
import library from '@zxing/library';
import browser from '@zxing/browser';
import { code128Fixture, code128Value, ean13Fixture, ean13Value } from './barcode-fixtures.mjs';

for (const [name, fixture, expected] of [['Code 128 with leading zeros', code128Fixture, code128Value], ['EAN-13', ean13Fixture, ean13Value]]) {
  test(`the actual browser fallback decoder reads ${name}`, () => {
    const source = new library.RGBLuminanceSource(fixture.pixels, fixture.width, fixture.height);
    const bitmap = new library.BinaryBitmap(new library.HybridBinarizer(source));
    const result = new browser.BrowserMultiFormatReader().decodeBitmap(bitmap);
    assert.equal(result.getText(), expected);
  });
}