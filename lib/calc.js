// lib/calc.js — split-the-bill maths.
//
// All money is in KSh. Per-person totals are rounded to cents with a
// largest-remainder pass so they always sum EXACTLY to the grand total.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeBill(bill) {
  const people = bill.people || [];
  const items = bill.items || [];
  const n = people.length;

  const subtotal = round2(items.reduce((s, it) => s + it.price * it.qty, 0));

  let discountAmount = 0;
  if (bill.discount && bill.discount.value) {
    discountAmount = bill.discount.type === 'amount'
      ? Math.min(bill.discount.value, subtotal)
      : (subtotal * bill.discount.value) / 100;
  }
  discountAmount = round2(discountAmount);
  const discounted = round2(subtotal - discountAmount);

  // Tip and tax are charged on the discounted subtotal.
  const taxAmount = round2((discounted * (bill.taxPercent || 0)) / 100);
  const tipAmount = round2((discounted * (bill.tipPercent || 0)) / 100);
  const grandTotal = round2(discounted + taxAmount + tipAmount);

  // ---- raw per-person shares of the discounted subtotal ----
  const rawShares = {};
  const rawLines = {}; // personId -> [{name, qty, sharedWith, amount}]
  people.forEach((p) => { rawShares[p.id] = 0; rawLines[p.id] = []; });

  if (n > 0) {
    const discountFactor = subtotal > 0 ? discounted / subtotal : 1;
    if (bill.splitMode === 'percent') {
      const pcts = bill.percentages || {};
      const sum = people.reduce((s, p) => s + (pcts[p.id] || 0), 0);
      people.forEach((p) => {
        const frac = sum > 0 ? (pcts[p.id] || 0) / sum : 1 / n;
        rawShares[p.id] = discounted * frac;
      });
    } else if (bill.splitMode === 'item') {
      items.forEach((it) => {
        const lineNet = it.price * it.qty * discountFactor;
        let targets = (it.assignedTo || []).filter((id) => id in rawShares);
        if (targets.length === 0) targets = people.map((p) => p.id); // unassigned = shared by everyone
        const each = lineNet / targets.length;
        targets.forEach((id) => {
          rawShares[id] += each;
          rawLines[id].push({ name: it.name, qty: it.qty, sharedWith: targets.length, amount: each });
        });
      });
    } else {
      // 'equal'
      people.forEach((p) => { rawShares[p.id] = discounted / n; });
    }
  }

  // ---- extras (tax/tip) allocated in proportion to item shares ----
  const persons = people.map((p) => {
    const itemShare = rawShares[p.id] || 0;
    const frac = discounted > 0 ? itemShare / discounted : (n ? 1 / n : 0);
    return {
      personId: p.id,
      name: p.name,
      itemsRaw: itemShare,
      taxRaw: taxAmount * frac,
      tipRaw: tipAmount * frac,
      totalRaw: itemShare + taxAmount * frac + tipAmount * frac,
    };
  });

  // Largest-remainder rounding: floor everyone's total to cents, then hand
  // the leftover cents to the people whose totals lost the most to flooring.
  const totalsCents = persons.map((p) => Math.floor(p.totalRaw * 100));
  let remainder = Math.round(grandTotal * 100) - totalsCents.reduce((a, b) => a + b, 0);
  const order = persons
    .map((p, i) => i)
    .sort((a, b) => (persons[b].totalRaw * 100 - totalsCents[b]) - (persons[a].totalRaw * 100 - totalsCents[a]));
  let k = 0;
  while (remainder > 0 && order.length) { totalsCents[order[k % order.length]] += 1; remainder -= 1; k += 1; }
  while (remainder < 0 && order.length) { totalsCents[order[k % order.length]] -= 1; remainder += 1; k += 1; }

  const perPerson = persons.map((p, i) => {
    const total = totalsCents[i] / 100;
    const tax = round2(p.taxRaw);
    const tip = round2(p.tipRaw);
    const itemsAmt = round2(total - tax - tip); // absorbs component rounding so parts sum to the total
    const lines = (rawLines[p.personId] || []).map((l) => ({
      name: l.name, qty: l.qty, sharedWith: l.sharedWith, amount: round2(l.amount),
    }));
    if (lines.length) {
      const diff = round2(itemsAmt - lines.reduce((s, l) => s + l.amount, 0));
      if (diff !== 0) {
        let idx = 0;
        lines.forEach((l, j) => { if (l.amount > lines[idx].amount) idx = j; });
        lines[idx].amount = round2(lines[idx].amount + diff);
      }
    }
    return {
      personId: p.personId,
      name: p.name,
      items: itemsAmt,
      tax,
      tip,
      total,
      lines,
      paid: Boolean(bill.paidBy && bill.paidBy[p.personId]),
    };
  });

  // ---- settle up: if one person paid the café, everyone else owes them ----
  let settleUp = [];
  const payer = people.find((p) => p.id === bill.payerId);
  if (payer) {
    settleUp = perPerson
      .filter((pp) => pp.personId !== payer.id)
      .map((pp) => ({
        fromId: pp.personId, from: pp.name,
        toId: payer.id, to: payer.name,
        amount: pp.total, settled: pp.paid,
      }));
  }

  return { subtotal, discountAmount, discountedSubtotal: discounted, taxAmount, tipAmount, grandTotal, perPerson, settleUp };
}

module.exports = { computeBill, round2 };
