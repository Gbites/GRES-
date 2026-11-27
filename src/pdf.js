const PDFDocument = require('pdfkit');

function inr(n) {
  const num = Number(n || 0);
  return 'Rs. ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generates a crisp GST Tax Invoice PDF directly into the Express HTTP response.
 */
function streamInvoicePdf(res, invoice, branch, settings) {
  const cust = settings?.customization || {};
  const billCfg = cust.billing || {};
  const paper = billCfg.paperSize || settings?.thermal_width || 'A4';
  const isThermalPaper = paper === '58mm' || paper === '80mm';
  const pageSpec = paper === '58mm'
    ? [164, 680]
    : paper === '80mm'
      ? [226, 720]
      : paper === 'A5'
        ? 'A5'
        : 'A4';
  const margin = isThermalPaper ? 12 : (paper === 'A5' ? 24 : 40);

  const doc = new PDFDocument({ size: pageSpec, margin });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;
  const rightEdge = pageWidth - margin;
  const alignHdr = billCfg.logoPlacement === 'left' ? 'left' : 'center';

  const items = JSON.parse(invoice.items_snapshot_json || '[]');
  const taxSlabs = JSON.parse(invoice.tax_slabs_json || '[]');
  const showGstin = billCfg.showGstin !== false;
  const showFssai = billCfg.showFssai !== false;
  const showTableInfo = billCfg.showTableInfo !== false;
  const showCustomerInfo = billCfg.showCustomerInfo !== false;
  const showItemGst = !isThermalPaper && billCfg.showItemGst !== false;
  const showTaxBreakdown = billCfg.showTaxBreakdown !== false;
  const showGstSummary = billCfg.showGstSummary !== false && !isThermalPaper;

  // Header
  doc.fontSize(isThermalPaper ? 12 : 18).font('Helvetica-Bold').text(
    settings?.restaurant_name || branch?.name || 'GRES Restaurant',
    { align: isThermalPaper ? 'center' : alignHdr }
  );
  doc.fontSize(isThermalPaper ? 7.5 : 9.5).font('Helvetica').fillColor('#444444');
  if (billCfg.header) doc.text(billCfg.header, { align: isThermalPaper ? 'center' : alignHdr });
  else if (settings?.receipt_header) doc.text(settings.receipt_header, { align: isThermalPaper ? 'center' : alignHdr });
  if (settings?.tagline) doc.text(settings.tagline, { align: isThermalPaper ? 'center' : alignHdr });
  if (branch?.name) doc.text(`Branch: ${branch.name} (${branch.code || ''})`, { align: isThermalPaper ? 'center' : 'left' });
  if (branch?.address) doc.text(branch.address, { align: isThermalPaper ? 'center' : 'left' });
  if (branch?.phone) doc.text(`Phone: ${branch.phone}`, { align: isThermalPaper ? 'center' : 'left' });
  if ((showGstin && branch?.gstin) || (showFssai && branch?.fssai)) {
    const parts = [];
    if (showGstin && branch?.gstin) parts.push(`GSTIN: ${branch.gstin}`);
    if (showFssai && branch?.fssai) parts.push(`FSSAI: ${branch.fssai}`);
    doc.text(parts.join('   |   '), { align: isThermalPaper ? 'center' : 'left' });
  }

  doc.moveDown(0.6);
  doc.strokeColor('#222222').lineWidth(1).moveTo(margin, doc.y).lineTo(rightEdge, doc.y).stroke();
  doc.moveDown(0.5);

  // Invoice Title & Meta
  const metaTop = doc.y;
  doc.fontSize(isThermalPaper ? 9.5 : 13).font('Helvetica-Bold').fillColor('#000000').text('TAX INVOICE', margin, metaTop);
  doc.fontSize(isThermalPaper ? 7.5 : 9.5).font('Helvetica').fillColor('#222222');

  if (isThermalPaper) {
    doc.text(`Invoice: ${invoice.invoice_number}`);
    doc.text(`Date: ${invoice.created_at}`);
    if (showTableInfo) doc.text(`Table: ${invoice.table_name || 'Counter'} (${String(invoice.order_type || '').toUpperCase()})`);
    if (showCustomerInfo) doc.text(`Guest: ${invoice.customer_name || 'Walk-in Guest'}`);
    doc.text(`Payment: ${String(invoice.payment_mode || '').toUpperCase()}`);
    doc.moveDown(0.3);
  } else {
    const col2X = margin + contentWidth * 0.56;
    doc.text(`Invoice No: ${invoice.invoice_number}`, margin, metaTop + 18);
    doc.text(`Date: ${invoice.created_at}`, margin, metaTop + 32);
    doc.text(`Order Type: ${String(invoice.order_type || '').toUpperCase()}`, margin, metaTop + 46);

    if (showTableInfo) doc.text(`Table / Ref: ${invoice.table_name || 'Counter'}`, col2X, metaTop + 18);
    if (showCustomerInfo) doc.text(`Customer: ${invoice.customer_name || 'Walk-in Guest'}`, col2X, metaTop + 32);
    doc.text(`Payment Mode: ${String(invoice.payment_mode || '').toUpperCase()}`, col2X, metaTop + 46);
    doc.y = metaTop + 68;
  }

  doc.strokeColor('#cccccc').lineWidth(0.75).moveTo(margin, doc.y).lineTo(rightEdge, doc.y).stroke();
  doc.moveDown(0.4);

  // Table Headers
  const wAmt = isThermalPaper ? 48 : 72;
  const wGst = showItemGst ? 40 : 0;
  const wRate = isThermalPaper ? 0 : 60;
  const wQty = isThermalPaper ? 24 : 36;
  const wItem = Math.max(60, contentWidth - wAmt - wGst - wRate - wQty - 8);
  const xItem = margin;
  const xQty = xItem + wItem + 2;
  const xRate = xQty + wQty + 2;
  const xGst = xRate + wRate + (wRate ? 2 : 0);
  const xAmt = rightEdge - wAmt;

  const hdrY = doc.y;
  doc.fontSize(isThermalPaper ? 7.5 : 9).font('Helvetica-Bold').fillColor('#000000');
  doc.text('ITEM', xItem, hdrY, { width: wItem });
  doc.text('QTY', xQty, hdrY, { width: wQty, align: 'right' });
  if (wRate) doc.text('RATE', xRate, hdrY, { width: wRate, align: 'right' });
  if (wGst) doc.text('GST%', xGst, hdrY, { width: wGst, align: 'right' });
  doc.text('AMT', xAmt, hdrY, { width: wAmt, align: 'right' });

  doc.moveDown(0.35);
  doc.strokeColor('#222222').lineWidth(0.75).moveTo(margin, doc.y).lineTo(rightEdge, doc.y).stroke();
  doc.moveDown(0.35);

  // Items
  doc.font('Helvetica').fontSize(isThermalPaper ? 7.5 : 9.5).fillColor('#111111');
  for (const it of items) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const rowY = doc.y;
    const label = it.variant_name ? `${it.name} (${it.variant_name})` : it.name;
    doc.text(label, xItem, rowY, { width: wItem });
    doc.text(String(it.qty), xQty, rowY, { width: wQty, align: 'right' });
    if (wRate) doc.text(inr(it.unit_price), xRate, rowY, { width: wRate, align: 'right' });
    if (wGst) doc.text(`${it.gst_rate ?? 5}%`, xGst, rowY, { width: wGst, align: 'right' });
    doc.text(inr(it.line_gross ?? it.qty * it.unit_price), xAmt, rowY, { width: wAmt, align: 'right' });
    doc.moveDown(isThermalPaper ? 0.4 : 0.55);
  }

  doc.moveDown(0.3);
  doc.strokeColor('#222222').lineWidth(0.75).moveTo(margin, doc.y).lineTo(rightEdge, doc.y).stroke();
  doc.moveDown(0.5);

  // Totals Block (Right Aligned)
  const labelW = isThermalPaper ? 75 : 125;
  const valW = isThermalPaper ? 65 : 95;
  const valX = rightEdge - valW;
  const labelX = valX - labelW - 4;
  function totalLine(label, value, bold = false) {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? (isThermalPaper ? 9 : 11) : (isThermalPaper ? 7.5 : 9.5));
    doc.text(label, labelX, y, { width: labelW, align: 'right' });
    doc.text(value, valX, y, { width: valW, align: 'right' });
    doc.moveDown(0.4);
  }

  totalLine('Subtotal:', inr(invoice.subtotal));
  if (Number(invoice.discount_amount) > 0) {
    totalLine('Discount:', `- ${inr(invoice.discount_amount)}`);
  }
  if (showTaxBreakdown) {
    totalLine('Taxable Value:', inr(invoice.taxable_amount));
    if (Number(invoice.service_charge_amount) > 0) {
      totalLine('Service Charge:', inr(invoice.service_charge_amount));
    }
    if (Number(invoice.packaging_charge) > 0) {
      totalLine('Packaging Charge:', inr(invoice.packaging_charge));
    }
    if (Number(invoice.igst_amount) > 0) {
      totalLine('IGST:', inr(invoice.igst_amount));
    } else if (Number(invoice.cgst_amount) > 0 || Number(invoice.sgst_amount) > 0 || settings?.gst_enabled !== 0) {
      totalLine('CGST:', inr(invoice.cgst_amount));
      totalLine('SGST:', inr(invoice.sgst_amount));
    }
  }
  if (Number(invoice.round_off) !== 0) {
    totalLine('Round Off:', inr(invoice.round_off));
  }

  doc.moveDown(0.2);
  doc.strokeColor('#000000').lineWidth(1).moveTo(labelX, doc.y).lineTo(rightEdge, doc.y).stroke();
  doc.moveDown(0.35);
  totalLine('GRAND TOTAL:', inr(invoice.grand_total), true);

  // GST Slab Breakdown
  if (showGstSummary && taxSlabs.length > 0) {
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(9).text('GST TAX BREAKDOWN SUMMARY', margin);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8.5).fillColor('#333333');
    for (const slab of taxSlabs) {
      doc.text(
        `GST ${slab.rate}%   |   Taxable: ${inr(slab.taxable)}   |   CGST (${slab.rate / 2}%): ${inr(slab.cgst)}   |   SGST (${slab.rate / 2}%): ${inr(slab.sgst)}   |   Total Tax: ${inr(slab.total_tax)}`,
        margin,
        doc.y,
        { width: contentWidth }
      );
    }
  }

  if (billCfg.paymentInstructions) {
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(isThermalPaper ? 7.5 : 8.5).fillColor('#333333').text(
      `Payment Instructions: ${billCfg.paymentInstructions}`,
      margin,
      doc.y,
      { width: contentWidth, align: 'center' }
    );
  }

  // Footer
  doc.moveDown(1.4);
  doc.font('Helvetica-Oblique').fontSize(isThermalPaper ? 7.5 : 9).fillColor('#555555').text(
    billCfg.footer || settings?.receipt_footer || 'Thank you for dining with us!',
    margin,
    doc.y,
    { width: contentWidth, align: 'center' }
  );
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(isThermalPaper ? 6.5 : 8).fillColor('#888888').text(
    'Powered by GRES (GRES Restaurant Management System) — Run Your Restaurant Smarter.',
    margin,
    doc.y,
    { width: contentWidth, align: 'center' }
  );

  doc.end();
}

module.exports = { streamInvoicePdf };
