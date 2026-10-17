'use strict';
// Minimal dependency-free PDF 1.4 writer (Helvetica text, uncompressed content stream → text is extractable).
function esc(s) { return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1'); }
function textPdf(lines) {
  const content = ['BT', '/F1 12 Tf', '50 790 Td', '16 TL'];
  lines.forEach((l, i) => { content.push(i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`); });
  content.push('ET');
  const stream = content.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const pkr = (minor) => `PKR ${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
function receiptPdf(p) {
  const lines = ['NaSCon Club Store - Receipt', `Order: ${p.order_id}`, `Customer: ${p.customer_id}`, `Paid at: ${p.paid_at}`, ''];
  for (const it of p.items) lines.push(`${it.variant_id} x${it.quantity} @ ${pkr(it.unit_price_minor)}`);
  lines.push('', `Subtotal: ${pkr(p.subtotal_minor)}`, `Discount: ${pkr(p.discount_minor)}`, `Total: ${pkr(p.total_minor)}`);
  return textPdf(lines);
}
module.exports = { textPdf, receiptPdf, pkr };
