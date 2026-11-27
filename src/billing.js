/**
 * Deterministic server-side GST & restaurant billing calculation engine.
 * All monetary amounts are rounded cleanly to 2 decimal places (INR paise-safe).
 */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Computes itemized and aggregate totals strictly on the server from DB prices & branch/org tax rules.
 *
 * @param {Array} items - [{ name, qty, unit_price, gst_rate, status }]
 * @param {Object} options
 * @param {string} options.taxMode - 'exclusive' | 'inclusive' | 'composition'
 * @param {number} options.compositionRate - e.g. 5 for 5% composition GST
 * @param {string} options.discountType - 'none' | 'percent' | 'flat'
 * @param {number} options.discountValue - discount % or flat INR
 * @param {number} options.serviceChargeRate - e.g. 5 for 5%
 * @param {boolean} options.roundOffEnabled - whether to round grand total to nearest whole INR
 */
function calculateOrderBill(items, options = {}) {
  const gstEnabled = options.gstEnabled !== false;
  const taxMode = options.taxMode || 'exclusive';
  const compositionRate = Number(options.compositionRate ?? 5);
  const igstRate = Math.max(0, Number(options.igstRate || 0));
  const discountType = options.discountType || 'none';
  const discountValue = Math.max(0, Number(options.discountValue || 0));
  const serviceChargeRate = Math.max(0, Number(options.serviceChargeRate || 0));
  const packagingCharge = Math.max(0, Number(options.packagingCharge || 0));
  const roundOffEnabled = Boolean(options.roundOffEnabled);

  const activeItems = (items || []).filter((it) => it.status !== 'void');

  let rawSubtotal = 0;
  const computedLines = activeItems.map((it) => {
    const qty = Math.max(0, Number(it.qty || 0));
    const unitPrice = Math.max(0, Number(it.unit_price || 0));
    const gstRate = !gstEnabled ? 0 : Math.max(0, Number(it.gst_rate ?? 5));
    const lineGross = round2(qty * unitPrice);

    let baseAmount = lineGross;
    let lineTax = 0;

    if (!gstEnabled) {
      baseAmount = lineGross;
      lineTax = 0;
    } else if (taxMode === 'inclusive') {
      baseAmount = round2(lineGross / (1 + gstRate / 100));
      lineTax = round2(lineGross - baseAmount);
    } else if (taxMode === 'composition') {
      baseAmount = lineGross;
      lineTax = round2((lineGross * compositionRate) / 100);
    } else {
      baseAmount = lineGross;
      lineTax = round2((lineGross * gstRate) / 100);
    }

    rawSubtotal = round2(rawSubtotal + baseAmount);
    return {
      ...it,
      qty,
      unit_price: unitPrice,
      gst_rate: !gstEnabled ? 0 : (taxMode === 'composition' ? compositionRate : gstRate),
      line_gross: lineGross,
      base_amount: baseAmount,
      line_tax: lineTax
    };
  });

  // Discount applies proportionally across line bases before GST recalculation (GST compliance)
  let discountAmount = 0;
  if (discountType === 'percent' && rawSubtotal > 0) {
    const pct = Math.min(100, discountValue);
    discountAmount = round2((rawSubtotal * pct) / 100);
  } else if (discountType === 'flat' && rawSubtotal > 0) {
    discountAmount = round2(Math.min(rawSubtotal, discountValue));
  }

  const taxableSubtotal = round2(Math.max(0, rawSubtotal - discountAmount));
  const discountRatio = rawSubtotal > 0 ? taxableSubtotal / rawSubtotal : 1;

  // Service charge applied on post-discount base
  const serviceChargeAmount = round2((taxableSubtotal * serviceChargeRate) / 100);

  let totalTax = 0;
  const taxBreakdownMap = {};

  if (gstEnabled) {
    for (const line of computedLines) {
      const adjustedBase = round2(line.base_amount * discountRatio);
      const rate = igstRate > 0 ? igstRate : line.gst_rate;
      const taxAmt = round2((adjustedBase * rate) / 100);
      totalTax = round2(totalTax + taxAmt);

      const key = String(rate);
      if (!taxBreakdownMap[key]) {
        taxBreakdownMap[key] = { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total_tax: 0 };
      }
      taxBreakdownMap[key].taxable = round2(taxBreakdownMap[key].taxable + adjustedBase);
      taxBreakdownMap[key].total_tax = round2(taxBreakdownMap[key].total_tax + taxAmt);
      if (igstRate > 0) {
        taxBreakdownMap[key].igst = taxBreakdownMap[key].total_tax;
      } else {
        taxBreakdownMap[key].cgst = round2(taxBreakdownMap[key].total_tax / 2);
        taxBreakdownMap[key].sgst = round2(taxBreakdownMap[key].total_tax - taxBreakdownMap[key].cgst);
      }
    }

    // Apply standard 5% GST on service charge if service charge > 0 and not composition
    if (serviceChargeAmount > 0 && taxMode !== 'composition') {
      const scRate = igstRate > 0 ? igstRate : 5;
      const scTax = round2((serviceChargeAmount * scRate) / 100);
      totalTax = round2(totalTax + scTax);
      const key = String(scRate);
      if (!taxBreakdownMap[key]) {
        taxBreakdownMap[key] = { rate: scRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total_tax: 0 };
      }
      taxBreakdownMap[key].taxable = round2(taxBreakdownMap[key].taxable + serviceChargeAmount);
      taxBreakdownMap[key].total_tax = round2(taxBreakdownMap[key].total_tax + scTax);
      if (igstRate > 0) {
        taxBreakdownMap[key].igst = taxBreakdownMap[key].total_tax;
      } else {
        taxBreakdownMap[key].cgst = round2(taxBreakdownMap[key].total_tax / 2);
        taxBreakdownMap[key].sgst = round2(taxBreakdownMap[key].total_tax - taxBreakdownMap[key].cgst);
      }
    }
  }

  const igstAmount = igstRate > 0 ? totalTax : 0;
  const cgstAmount = igstRate > 0 ? 0 : round2(totalTax / 2);
  const sgstAmount = igstRate > 0 ? 0 : round2(totalTax - cgstAmount);
  const preRoundTotal = round2(taxableSubtotal + serviceChargeAmount + packagingCharge + totalTax);

  let roundOff = 0;
  let grandTotal = preRoundTotal;
  if (roundOffEnabled) {
    grandTotal = Math.round(preRoundTotal);
    roundOff = round2(grandTotal - preRoundTotal);
  }

  return {
    gst_enabled: gstEnabled,
    tax_mode: taxMode,
    item_count: activeItems.reduce((sum, i) => sum + Number(i.qty || 0), 0),
    subtotal: rawSubtotal,
    discount_type: discountType,
    discount_value: discountValue,
    discount_amount: discountAmount,
    taxable_amount: taxableSubtotal,
    service_charge_rate: serviceChargeRate,
    service_charge_amount: serviceChargeAmount,
    packaging_charge: packagingCharge,
    cgst_amount: cgstAmount,
    sgst_amount: sgstAmount,
    igst_amount: igstAmount,
    tax_amount: totalTax,
    round_off: roundOff,
    grand_total: grandTotal,
    tax_slabs: Object.values(taxBreakdownMap).sort((a, b) => a.rate - b.rate),
    lines: computedLines
  };
}

module.exports = { round2, calculateOrderBill };
