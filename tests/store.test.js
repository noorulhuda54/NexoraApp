'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
const { sign } = require('../backend/src/lib');
after(stop);
beforeEach(() => post('/audit/v1/reset', { stock: { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 } }));
const order = (id, extra = {}) => ({ order_id: id, customer_id: 'cust-001', items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }], discount_code: null, payment: { token: 'tok_success' }, ...extra });

test('20 simultaneous buyers of the last unit → exactly one 201, nineteen 409', async () => {
  const rs = await Promise.all([...Array(20)].map((_, i) => post('/audit/v1/checkout', order('ord-' + i))));
  const codes = rs.map((r) => r.status).sort();
  assert.strictEqual(codes.filter((c) => c === 201).length, 1);
  assert.strictEqual(codes.filter((c) => c === 409).length, 19);
  rs.filter((r) => r.status === 409).forEach((r) => { assert.strictEqual(r.body.error.code, 'OUT_OF_STOCK'); assert.strictEqual(r.body.error.details.variant_id, 'var-jersey-001-M'); });
  assert.deepStrictEqual((await get('/audit/v1/inventory/var-jersey-001-M')).body, { variant_id: 'var-jersey-001-M', stock: 0, reserved: 0 });
});
test('receipt signature, PDF and idempotent replay', async () => {
  const r = await post('/audit/v1/checkout', order('ord-1'));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.total_minor, 450000);
  assert.strictEqual(r.body.receipt.signature, sign('ord-1', r.body.receipt.payload, 'demo-salt'));
  const pdf = Buffer.from(r.body.receipt.pdf_base64, 'base64').toString('latin1');
  assert.ok(pdf.startsWith('%PDF')); assert.ok(pdf.includes('ord-1')); assert.ok(pdf.includes('PKR 4500.00'));
  const again = await post('/audit/v1/checkout', order('ord-1'));
  assert.strictEqual(again.status, 200); assert.deepStrictEqual(again.body, r.body);
  const diff = await post('/audit/v1/checkout', order('ord-1', { customer_id: 'other' }));
  assert.strictEqual(diff.body.error.code, 'DUPLICATE_ORDER_ID');
});
test('payment failures release reservation; discount; validation', async () => {
  let r = await post('/audit/v1/checkout', order('o-d', { payment: { token: 'tok_declined' } }));
  assert.strictEqual(r.status, 402); assert.strictEqual(r.body.error.code, 'PAYMENT_DECLINED');
  r = await post('/audit/v1/checkout', order('o-c', { payment: { token: 'tok_capture_fail' } }));
  assert.strictEqual(r.status, 402); assert.strictEqual(r.body.error.code, 'PAYMENT_CAPTURE_FAILED');
  assert.strictEqual((await get('/audit/v1/inventory/var-jersey-001-M')).body.stock, 1);
  r = await post('/audit/v1/checkout', order('o-w', { items: [{ variant_id: 'var-jersey-001-L', quantity: 3 }], discount_code: 'WELCOME10' }));
  assert.strictEqual(r.body.subtotal_minor, 1350000); assert.strictEqual(r.body.discount_minor, 135000); assert.strictEqual(r.body.total_minor, 1215000);
  assert.strictEqual((await post('/audit/v1/checkout', order('o-x', { discount_code: 'NOPE' }))).body.error.code, 'INVALID_DISCOUNT_CODE');
  assert.strictEqual((await post('/audit/v1/checkout', order('o-y', { items: [{ variant_id: 'nope', quantity: 1 }] }))).body.error.code, 'VARIANT_NOT_FOUND');
  assert.strictEqual((await post('/audit/v1/checkout', order('o-z', { items: [] }))).status, 400);
  const xss = await post('/audit/v1/checkout', order('o-s', { customer_id: '"<script>alert(1)</script>' }));
  assert.strictEqual(xss.status, 201); assert.strictEqual(xss.body.receipt.payload.customer_id, '"<script>alert(1)</script>');
  assert.strictEqual((await get('/audit/v1/inventory/nope')).status, 404);
});
