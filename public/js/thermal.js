(function () {
  'use strict';

  function padLine(left, right, width) {
    const l = String(left);
    const r = String(right);
    const space = Math.max(1, width - l.length - r.length);
    return l.slice(0, Math.max(1, width - r.length - 1)) + ' '.repeat(space) + r;
  }

  function buildEscPosBytes(invoice, branch, settings) {
    const chars = settings?.thermal_width === '58mm' ? 32 : 48;
    const sep = '-'.repeat(chars) + '\n';
    const items = Array.isArray(invoice.items)
      ? invoice.items
      : JSON.parse(invoice.items_snapshot_json || '[]');
    const sym = settings?.currency_code === 'INR' ? 'Rs.' : (settings?.currency_symbol || 'Rs.');

    const chunks = [];
    const push = (str) => chunks.push(str);

    // ESC @ (Init), ESC a 1 (Center)
    chunks.push('\x1B@');
    chunks.push('\x1Ba\x01');
    chunks.push('\x1BE\x01'); // Bold on
    push(`${settings?.restaurant_name || branch?.name || 'GRES Restaurant'}\n`);
    chunks.push('\x1BE\x00'); // Bold off
    if (branch?.name) push(`${branch.name}\n`);
    if (branch?.address) push(`${branch.address}\n`);
    if (branch?.gstin) push(`GSTIN: ${branch.gstin}\n`);
    if (branch?.fssai) push(`FSSAI: ${branch.fssai}\n`);
    push(sep);

    chunks.push('\x1Ba\x00'); // Align Left
    push(`INV: ${invoice.invoice_number}\n`);
    push(`DATE: ${invoice.created_at}\n`);
    push(`TABLE: ${invoice.table_name || 'Counter'} | ${String(invoice.order_type || '').toUpperCase()}\n`);
    push(`GUEST: ${invoice.customer_name || 'Walk-in'}\n`);
    push(sep);
    push(padLine('ITEM x QTY', 'AMOUNT', chars) + '\n');
    push(sep);

    for (const it of items) {
      const label = `${it.name}${it.variant_name ? ` (${it.variant_name})` : ''} x${it.qty}`;
      const amt = `${sym}${(it.line_gross ?? it.qty * it.unit_price).toFixed(2)}`;
      push(padLine(label, amt, chars) + '\n');
    }

    push(sep);
    push(padLine('Subtotal', `${sym}${Number(invoice.subtotal).toFixed(2)}`, chars) + '\n');
    if (Number(invoice.discount_amount) > 0) {
      push(padLine('Discount', `-${sym}${Number(invoice.discount_amount).toFixed(2)}`, chars) + '\n');
    }
    if (Number(invoice.service_charge_amount) > 0) {
      push(padLine('Service Charge', `${sym}${Number(invoice.service_charge_amount).toFixed(2)}`, chars) + '\n');
    }
    push(padLine('CGST', `${sym}${Number(invoice.cgst_amount).toFixed(2)}`, chars) + '\n');
    push(padLine('SGST', `${sym}${Number(invoice.sgst_amount).toFixed(2)}`, chars) + '\n');
    push(sep);
    chunks.push('\x1BE\x01');
    push(padLine('GRAND TOTAL', `${sym}${Number(invoice.grand_total).toFixed(2)}`, chars) + '\n');
    chunks.push('\x1BE\x00');
    push(padLine('Payment Mode', String(invoice.payment_mode || '').toUpperCase(), chars) + '\n');
    push(sep);
    chunks.push('\x1Ba\x01');
    push(`${settings?.receipt_footer || 'Thank you!'}\n`);
    push('Powered by GRES - Run Your Restaurant Smarter.\n\n\n');
    // GS V 66 0 (Partial Cut)
    chunks.push('\x1DV\x42\x00');

    return new TextEncoder().encode(chunks.join(''));
  }

  function buildReceiptHtml(invoice, branch, settings) {
    const { esc, formatINR, formatDate } = window.BistroAPI;
    const cust = settings?.customization || {};
    const billCfg = cust.billing || {};
    const brandCfg = cust.branding || {};
    const items = Array.isArray(invoice.items)
      ? invoice.items
      : JSON.parse(invoice.items_snapshot_json || '[]');
    const sym = settings?.currency_symbol || '₹';
    const placement = billCfg.logoPlacement || 'center';
    const alignClass = placement === 'left' ? '' : 'thermal-center';
    const showLogo = brandCfg.showReceiptLogo !== false && placement !== 'hidden' && settings?.logo_url;
    const showGstin = billCfg.showGstin !== false;
    const showFssai = billCfg.showFssai !== false;
    const showTable = billCfg.showTableInfo !== false;
    const showCust = billCfg.showCustomerInfo !== false;
    const showTax = billCfg.showTaxBreakdown !== false;
    const tpl = billCfg.template || 'modern';

    return `
      <div class="inv-tpl-${esc(tpl)}">
        <div class="${alignClass}">
          ${showLogo ? `<img src="${esc(settings.logo_url)}" alt="Logo" style="max-height:42px;max-width:120px;object-fit:contain;margin-bottom:4px"><br>` : ''}
          <strong style="font-size:14px">${esc(settings?.restaurant_name || branch?.name || 'GRES Restaurant')}</strong><br>
          ${(billCfg.header || settings?.receipt_header) ? `<span>${esc(billCfg.header || settings.receipt_header)}</span><br>` : ''}
          ${settings?.tagline ? `<span>${esc(settings.tagline)}</span><br>` : ''}
          <span>${esc(branch?.name || '')}</span><br>
          <span>${esc(branch?.address || '')}</span><br>
          ${branch?.phone ? `<span>Ph: ${esc(branch.phone)}</span><br>` : ''}
          ${(showGstin && branch?.gstin) ? `<span>GSTIN: ${esc(branch.gstin)}</span><br>` : ''}
          ${(showFssai && branch?.fssai) ? `<span>FSSAI: ${esc(branch.fssai)}</span><br>` : ''}
        </div>
        <div class="thermal-hr"></div>
        <div>
          <div><strong>TAX INVOICE:</strong> ${esc(invoice.invoice_number)}</div>
          <div>Date: ${esc(formatDate ? formatDate(invoice.created_at, true) : invoice.created_at)}</div>
          ${showTable ? `<div>Table: ${esc(invoice.table_name || 'Counter')} (${esc(invoice.order_type)})</div>` : ''}
          ${showCust ? `<div>Guest: ${esc(invoice.customer_name || 'Walk-in Guest')}</div>` : ''}
        </div>
        <div class="thermal-hr"></div>
        <div class="thermal-row"><strong>ITEM</strong><strong>AMT</strong></div>
        <div class="thermal-hr"></div>
        ${items.map((it) => `
          <div class="thermal-row">
            <span>${esc(it.name)}${it.variant_name ? ` (${esc(it.variant_name)})` : ''} x${it.qty}${billCfg.showItemGst && tpl !== 'compact' ? ` <small>[${it.gst_rate ?? 5}%]</small>` : ''}</span>
            <span>${formatINR(it.line_gross ?? it.qty * it.unit_price, sym)}</span>
          </div>
        `).join('')}
        <div class="thermal-hr"></div>
        <div class="thermal-row"><span>Subtotal</span><span>${formatINR(invoice.subtotal, sym)}</span></div>
        ${Number(invoice.discount_amount) > 0 ? `<div class="thermal-row"><span>Discount</span><span>-${formatINR(invoice.discount_amount, sym)}</span></div>` : ''}
        ${Number(invoice.service_charge_amount) > 0 ? `<div class="thermal-row"><span>Service Chg</span><span>${formatINR(invoice.service_charge_amount, sym)}</span></div>` : ''}
        ${Number(invoice.packaging_charge) > 0 ? `<div class="thermal-row"><span>Packaging Chg</span><span>${formatINR(invoice.packaging_charge, sym)}</span></div>` : ''}
        ${showTax ? (
          Number(invoice.igst_amount) > 0
            ? `<div class="thermal-row"><span>IGST</span><span>${formatINR(invoice.igst_amount, sym)}</span></div>`
            : (Number(invoice.cgst_amount) > 0 || Number(invoice.sgst_amount) > 0 || settings?.gst_enabled !== 0)
            ? `<div class="thermal-row"><span>CGST</span><span>${formatINR(invoice.cgst_amount, sym)}</span></div>
               <div class="thermal-row"><span>SGST</span><span>${formatINR(invoice.sgst_amount, sym)}</span></div>`
            : ''
        ) : ''}
        ${Number(invoice.round_off) !== 0 ? `<div class="thermal-row"><span>Round Off</span><span>${formatINR(invoice.round_off, sym)}</span></div>` : ''}
        <div class="thermal-hr"></div>
        <div class="thermal-row" style="font-size:13px"><strong>GRAND TOTAL</strong><strong>${formatINR(invoice.grand_total, sym)}</strong></div>
        <div class="thermal-row"><span>Paid Via</span><span>${esc(String(invoice.payment_mode || '').toUpperCase())}</span></div>
        ${Number(invoice.change_due) > 0 ? `<div class="thermal-row"><span>Change Due</span><span>${formatINR(invoice.change_due, sym)}</span></div>` : ''}
        ${billCfg.paymentInstructions ? `<div class="thermal-hr"></div><div class="thermal-center" style="font-size:10px">${esc(billCfg.paymentInstructions)}</div>` : ''}
        <div class="thermal-hr"></div>
        <div class="thermal-center">
          <div>${esc(billCfg.footer || settings?.receipt_footer || 'Thank you for dining with us!')}</div>
          ${brandCfg.receiptBrandFooter ? `<div style="font-size:9.5px">${esc(brandCfg.receiptBrandFooter)}</div>` : ''}
          <div style="font-size:9px;margin-top:4px;opacity:0.75">Powered by GRES • Run Your Restaurant Smarter.</div>
        </div>
      </div>
    `;
  }

  function printThermalInvoice(invoice, branch, settings) {
    const area = document.getElementById('printArea');
    const paper = settings?.customization?.billing?.paperSize || settings?.thermal_width || '80mm';
    const widthClass = paper === '58mm'
      ? 'w-58mm'
      : paper === 'A4'
      ? 'w-A4'
      : paper === 'A5'
      ? 'w-A5'
      : 'w-80mm';
    area.className = `print-area ${widthClass}`;
    area.innerHTML = buildReceiptHtml(invoice, branch, settings);
    window.print();
  }

  function printKot(order, kotNumber, branch, settings) {
    const { esc } = window.BistroAPI;
    const area = document.getElementById('printArea');
    const widthClass = settings?.thermal_width === '58mm' ? 'w-58mm' : 'w-80mm';
    const items = (order.items || []).filter((i) => (!kotNumber || i.kot_number === kotNumber) && i.status !== 'void');
    area.className = `print-area ${widthClass}`;
    area.innerHTML = `
      <div class="thermal-center">
        <strong style="font-size:14px">KITCHEN ORDER TICKET</strong><br>
        <span>${esc(branch?.name || '')}</span>
      </div>
      <div class="thermal-hr"></div>
      <div><strong>KOT:</strong> ${esc(kotNumber || 'ALL')} | <strong>ORD:</strong> ${esc(order.order_number)}</div>
      <div><strong>Table:</strong> ${esc(order.table_name || order.order_type.toUpperCase())}</div>
      <div><strong>Time:</strong> ${new Date().toLocaleTimeString('en-IN')}</div>
      <div class="thermal-hr"></div>
      ${items.map((i) => `
        <div style="margin-bottom:4px">
          <div class="thermal-row"><strong>${i.qty} x ${esc(i.name)}</strong><span>[${esc(i.station)}]</span></div>
          ${i.variant_name ? `<div>  Var: ${esc(i.variant_name)}</div>` : ''}
          ${i.notes ? `<div>  Note: *${esc(i.notes)}*</div>` : ''}
        </div>
      `).join('')}
      <div class="thermal-hr"></div>
    `;
    window.print();
  }

  async function printDirectEscPos(invoice, branch, settings) {
    const bytes = buildEscPosBytes(invoice, branch, settings);
    if ('serial' in navigator) {
      try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        const writer = port.writable.getWriter();
        await writer.write(bytes);
        writer.releaseLock();
        await port.close();
        window.BistroAPI.toast('Sent ESC/POS payload directly to thermal printer!', 'success');
        return;
      } catch (err) {
        if (err && err.name === 'NotFoundError') {
          window.BistroAPI.toast('No serial thermal printer selected — downloading ESC/POS .bin file.', 'info');
        } else {
          window.BistroAPI.toast(`Serial print fallback: ${err.message}`, 'info');
        }
      }
    }
    // Clean fallback: download raw ESC/POS bytes so user can spool or inspect
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${invoice.invoice_number}.escpos.bin`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.BistroThermal = {
    buildReceiptHtml,
    printThermalInvoice,
    printKot,
    printDirectEscPos
  };
})();
