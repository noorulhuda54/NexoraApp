'use strict';
// Section 5.12 — concurrency-safe checkout with mock payment gateway, signed receipt and PDF.
// Reservation is a synchronous check-and-decrement inside the single Node.js event loop turn, so concurrent
// requests can never both take the last unit; stock is never negative.
const { err, vErr, isId, isObj, isInt, sign, canonical, nowIso, clone } = require('../lib');
const { S, put, nextCounter } = require('../state');
const { receiptPdf } = require('./pdf');

const DISCOUNTS = { WELCOME10: 10 };

function currentPrice(v, at = new Date().toISOString()) {
  let price = v.price_minor;
  for (const s of (v.price_schedule || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1))) if (s.from <= at) price = s.price_minor;
  return price;
}

const orderFp = (b) => canonical({ order_id: b.order_id, customer_id: b.customer_id, items: b.items, discount_code: b.discount_code ?? null, payment: b.payment });

// mock gateway: authorization then capture (async to model a network hop)
const tick = () => new Promise((r) => setImmediate(r));
async function gateway(token, amount) {
  await tick();
  if (token === 'tok_declined' || !['tok_success', 'tok_capture_fail'].includes(token)) return { ok: false, code: 'PAYMENT_DECLINED' };
  const authorization_id = 'auth_' + nextCounter('auth');
  await tick();
  if (token === 'tok_capture_fail') return { ok: false, code: 'PAYMENT_CAPTURE_FAILED', authorization_id, voided: true };
  return { ok: true, authorization_id, capture_id: 'cap_' + nextCounter('cap'), amount };
}

async function checkout(b) {
  const f = [];
  if (!isId(b.order_id)) f.push('order_id');
  if (typeof b.customer_id !== 'string' || b.customer_id.length < 1 || b.customer_id.length > 200) f.push('customer_id');
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 10
      || b.items.some((it) => !isObj(it) || typeof it.variant_id !== 'string' || !it.variant_id || !isInt(it.quantity) || it.quantity < 1 || it.quantity > 10)
      || new Set(b.items.map((it) => it && it.variant_id)).size !== b.items.length) f.push('items');
  if (b.discount_code !== undefined && b.discount_code !== null && typeof b.discount_code !== 'string') f.push('discount_code');
  if (!isObj(b.payment) || typeof b.payment.token !== 'string') f.push('payment');
  if (f.length) throw vErr(f);
  const prior = S.orders.get(b.order_id);
  if (prior) {
    if (prior._fp === orderFp(b)) return { status: 200, body: prior._response };
    throw err(409, 'DUPLICATE_ORDER_ID', `Order ${b.order_id} already exists with a different body.`, { order_id: b.order_id });
  }
  if (S.pendingOrders && S.pendingOrders.has(b.order_id)) {
    throw err(409, 'DUPLICATE_ORDER_ID', `Order ${b.order_id} is already being processed.`, { order_id: b.order_id });
  }
  for (const it of b.items) if (!S.variants.has(it.variant_id)) throw err(404, 'VARIANT_NOT_FOUND', `Variant ${it.variant_id} not found.`, { variant_id: it.variant_id });
  if (b.discount_code !== undefined && b.discount_code !== null && !DISCOUNTS[b.discount_code]) throw err(400, 'INVALID_DISCOUNT_CODE', `Discount code ${b.discount_code} is not valid.`, { discount_code: b.discount_code });
  // atomic reservation (no await between check and decrement)
  for (const it of b.items) {
    const v = S.variants.get(it.variant_id);
    if (v.stock < it.quantity) throw err(409, 'OUT_OF_STOCK', `Variant ${it.variant_id} has no stock left.`, { variant_id: it.variant_id });
  }
  for (const it of b.items) { const v = S.variants.get(it.variant_id); v.stock -= it.quantity; v.reserved += it.quantity; }
  if (!S.pendingOrders) S.pendingOrders = new Set();
  S.pendingOrders.add(b.order_id);
  const release = () => { for (const it of b.items) { const v = S.variants.get(it.variant_id); v.stock += it.quantity; v.reserved -= it.quantity; } S.pendingOrders.delete(b.order_id); };
  const items = b.items.map((it) => ({ variant_id: it.variant_id, quantity: it.quantity, unit_price_minor: currentPrice(S.variants.get(it.variant_id)) }));
  const subtotal = items.reduce((s, it) => s + it.unit_price_minor * it.quantity, 0);
  const discount = b.discount_code ? Math.floor(subtotal * DISCOUNTS[b.discount_code] / 100) : 0;
  const total = subtotal - discount;
  let pay;
  try { pay = await gateway(b.payment.token, total); } catch (e) { release(); throw e; }
  if (!pay.ok) {
    release();
    require('../queue').publish('order.status', { order_id: b.order_id, status: 'cancelled', reason: pay.code });
    throw err(402, pay.code, pay.code === 'PAYMENT_DECLINED' ? 'Payment was declined.' : 'Payment capture failed; authorization voided.', { order_id: b.order_id });
  }
  // commit
  for (const it of b.items) { const v = S.variants.get(it.variant_id); v.reserved -= it.quantity; put('variants', v.variant_id, v); }
  S.pendingOrders.delete(b.order_id);
  const payload = { order_id: b.order_id, customer_id: b.customer_id, items, subtotal_minor: subtotal, discount_minor: discount, total_minor: total, currency: 'PKR', paid_at: nowIso() };
  const response = {
    order_id: b.order_id, status: 'paid', currency: 'PKR', items: clone(items), subtotal_minor: subtotal, discount_minor: discount, total_minor: total,
    payment: { authorization_id: pay.authorization_id, capture_id: pay.capture_id, state: 'captured' },
    receipt: { payload, signature: sign(b.order_id, payload), pdf_base64: receiptPdf(payload).toString('base64') },
  };
  put('orders', b.order_id, { order_id: b.order_id, customer_id: b.customer_id, status: 'paid', status_history: [{ status: 'pending', at: payload.paid_at }, { status: 'paid', at: payload.paid_at }], _fp: orderFp(b), _response: response });
  require('../queue').publish('order.status', { order_id: b.order_id, status: 'paid', total_minor: total });
  return { status: 201, body: response };
}

const ORDER_FLOW = { paid: ['packed', 'cancelled', 'refunded'], packed: ['shipped', 'cancelled', 'refunded'], shipped: ['delivered', 'refunded'], delivered: ['refunded'], pending: ['paid', 'cancelled'] };
function transitionOrder(orderId, to) {
  const o = S.orders.get(orderId);
  if (!o) throw err(404, 'ORDER_NOT_FOUND', `Order ${orderId} not found.`, { order_id: orderId });
  if (!(ORDER_FLOW[o.status] || []).includes(to)) throw err(409, 'ILLEGAL_TRANSITION', `Order cannot move from ${o.status} to ${to}.`, { order_id: orderId, from: o.status, to });
  if (to === 'refunded' || to === 'cancelled') {
    for (const it of o._response.items) { const v = S.variants.get(it.variant_id); if (v) { v.stock += it.quantity; put('variants', v.variant_id, v); } }
  }
  o.status = to; o.status_history.push({ status: to, at: nowIso() });
  put('orders', orderId, o);
  require('../queue').publish('order.status', { order_id: orderId, status: to });
  return { order_id: orderId, status: to, status_history: o.status_history };
}

function inventory(variantId) {
  const v = S.variants.get(variantId);
  if (!v) throw err(404, 'VARIANT_NOT_FOUND', `Variant ${variantId} not found.`, { variant_id: variantId });
  return { variant_id: variantId, stock: v.stock, reserved: v.reserved };
}

module.exports = { checkout, inventory, transitionOrder, currentPrice };
