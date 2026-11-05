// public/app.js — Karak & Go Split-the-Bill single-page app (vanilla JS, no build step).

let staffPin = sessionStorage.getItem('staffPin') || '';
let config = { staffPinRequired: false };
let menuItems = [];
let billList = [];
let current = null; // { bill, computed }
let customerView = false;

const app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

async function api(path, opts = {}, retry = true) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(staffPin ? { 'X-Staff-Pin': staffPin } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && retry) {
    const pin = prompt('Staff PIN required for this action:');
    if (pin) {
      staffPin = pin;
      sessionStorage.setItem('staffPin', pin);
      return api(path, opts, false);
    }
    throw new Error('Staff PIN required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------------- boot / routing ----------------
async function boot() {
  try {
    config = await api('/api/config');
    menuItems = (await api('/api/menu')).items;
  } catch (e) { /* menu/config are best-effort at boot */ }
  const m = location.pathname.match(/^\/bill\/([\w-]+)/);
  if (m) {
    customerView = true;
    document.getElementById('mainNav').style.display = 'none';
    await openBill(m[1]);
  } else {
    await goHome();
  }
}

async function goHome() {
  customerView = false;
  document.getElementById('mainNav').style.display = '';
  history.pushState({}, '', '/app');
  current = null;
  billList = (await api('/api/bills')).bills;
  renderHome();
}

function renderHome() {
  const open = billList.filter((b) => b.status === 'open');
  const settled = billList.filter((b) => b.status === 'settled');
  const row = (b) => `
    <div class="billrow" onclick="openBill('${b.id}')">
      <div>
        <strong>${esc(b.occasion || 'Bill')}</strong> ${b.table ? `<span class="muted">· Table ${esc(b.table)}</span>` : ''}
        <div class="small muted">${b.peopleCount} people · ${new Date(b.createdAt).toLocaleString()}</div>
      </div>
      <div style="text-align:right">
        <div class="total">${fmt(b.grandTotal)}</div>
        <span class="badge ${b.status === 'settled' ? 'settled' : ''}">${b.status}</span>
      </div>
    </div>`;
  app.innerHTML = `
    <div class="card">
      <h2>🍵 New bill</h2>
      <form onsubmit="createBill(event)">
        <label>Occasion</label>
        <input id="nbOccasion" placeholder="e.g. Birthday lunch" />
        <div class="grid2">
          <div><label>Table</label><input id="nbTable" placeholder="e.g. 4" /></div>
          <div><label>People (one name per line)</label><input id="nbPeople" placeholder="Amina, Brian, Ciku" /></div>
        </div>
        <p class="small muted">Separate names with commas or new lines. You can add more people later.</p>
        <button class="btn" type="submit">Start bill</button>
      </form>
    </div>
    <div class="card">
      <h3>Open bills</h3>
      ${open.length ? open.map(row).join('') : '<p class="muted">No open bills yet.</p>'}
    </div>
    <div class="card">
      <h3>Settled history</h3>
      ${settled.length ? settled.map((b) => row(b) + `
        <div class="row" style="padding-bottom:.6rem">
          <button class="btn small secondary" onclick="event.stopPropagation();reopenBill('${b.id}')">Reopen</button>
          <button class="btn small danger" onclick="event.stopPropagation();deleteBill('${b.id}')">Delete</button>
        </div>`).join('') : '<p class="muted">No settled bills yet.</p>'}
    </div>`;
}

async function createBill(ev) {
  ev.preventDefault();
  const raw = document.getElementById('nbPeople').value;
  const people = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (!people.length) { alert('Add at least one person.'); return; }
  const data = await api('/api/bills', {
    method: 'POST',
    body: {
      occasion: document.getElementById('nbOccasion').value,
      table: document.getElementById('nbTable').value,
      people,
    },
  });
  current = data;
  renderBill();
}

async function reopenBill(id) {
  await api(`/api/bills/${id}/reopen`, { method: 'POST' });
  await goHome();
}

async function deleteBill(id) {
  if (!confirm('Delete this bill permanently?')) return;
  try {
    await api(`/api/bills/${id}`, { method: 'DELETE' });
    if (current && current.bill.id === id) return goHome();
    await goHome();
  } catch (e) { alert(e.message); }
}

// ---------------- bill view ----------------
async function openBill(id) {
  try {
    current = await api(`/api/bills/${id}`);
    renderBill();
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Bill not found</h2><p class="muted">This bill link may have been deleted.</p></div>`;
  }
}

async function saveBill(patch) {
  Object.assign(current.bill, patch);
  const b = current.bill;
  current = await api(`/api/bills/${b.id}`, {
    method: 'PUT',
    body: {
      occasion: b.occasion, table: b.table, people: b.people, items: b.items,
      splitMode: b.splitMode, percentages: b.percentages, tipPercent: b.tipPercent,
      taxPercent: b.taxPercent, discount: b.discount, payerId: b.payerId, paidBy: b.paidBy,
    },
  });
  renderBill();
}

function renderBill() {
  const b = current.bill;
  const c = current.computed;
  const cats = [...new Set(menuItems.map((m) => m.category))];
  const personName = (id) => (b.people.find((p) => p.id === id) || {}).name || '?';

  const itemsHtml = b.items.length ? b.items.map((it) => `
    <div class="menuitem">
      <div style="flex:1">
        <strong>${esc(it.name)}</strong> <span class="muted">${fmt(it.price)}</span>
        ${b.splitMode === 'item' ? `<div style="margin-top:.3rem">${b.people.map((p) => `
          <span class="chip ${it.assignedTo.includes(p.id) ? 'on' : ''}" onclick="toggleAssign('${it.id}','${p.id}')">${esc(p.name)}</span>`).join('')}
          ${it.assignedTo.length === 0 ? '<span class="small muted">tap names — unassigned items are shared by everyone</span>' : ''}
        </div>` : ''}
      </div>
      <div class="row">
        <button class="qtybtn" onclick="changeQty('${it.id}',-1)">−</button>
        <strong style="min-width:1.4rem;text-align:center">${it.qty}</strong>
        <button class="qtybtn" onclick="changeQty('${it.id}',1)">+</button>
        <strong style="min-width:5.2rem;text-align:right">${fmt(it.price * it.qty)}</strong>
        <button class="btn small danger" onclick="removeItem('${it.id}')">✕</button>
      </div>
    </div>`).join('') : '<p class="muted">No items yet — add from the menu below.</p>';

  const menuHtml = cats.map((cat) => `
    <label>${esc(cat)}</label>
    <div class="row wrap">${menuItems.filter((m) => m.category === cat).map((m) => `
      <button class="btn small secondary" onclick="addFromMenu('${m.id}')">+ ${esc(m.name)} · ${fmt(m.price)}</button>`).join('')}
    </div>`).join('');

  const perPersonHtml = c.perPerson.map((pp) => `
    <div class="card personcard ${pp.paid ? 'paid' : ''}">
      <div class="row" style="justify-content:space-between">
        <strong>${esc(pp.name)}</strong>
        <span class="amt">${fmt(pp.total)}</span>
      </div>
      <div class="small muted">Items ${fmt(pp.items)}${pp.tax ? ` · Tax ${fmt(pp.tax)}` : ''}${pp.tip ? ` · Tip ${fmt(pp.tip)}` : ''}</div>
      ${pp.lines && pp.lines.length ? `<ul class="lines">${pp.lines.map((l) => `<li>${esc(l.name)} ×${l.qty}${l.sharedWith > 1 ? ` (shared ${l.sharedWith} ways)` : ''} — ${fmt(l.amount)}</li>`).join('')}</ul>` : ''}
      <label style="margin-top:.6rem"><input type="checkbox" style="width:auto" ${pp.paid ? 'checked' : ''} onchange="togglePaid('${pp.personId}')" /> Paid</label>
    </div>`).join('');

  const pctSum = b.people.reduce((s, p) => s + ((b.percentages || {})[p.id] || 0), 0);

  app.innerHTML = `
    ${customerView ? '<div class="card"><strong>Shared bill</strong><p class="small muted" style="margin:.3rem 0 0">You were sent this bill by the café. Check your card below for what you owe.</p></div>' : ''}
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">${esc(b.occasion || 'Bill')}</h2>
        <span class="badge ${b.status === 'settled' ? 'settled' : ''}">${b.status}</span>
      </div>
      <div class="grid2">
        <div><label>Occasion</label><input value="${esc(b.occasion)}" onchange="saveBill({occasion:this.value})" /></div>
        <div><label>Table</label><input value="${esc(b.table)}" onchange="saveBill({table:this.value})" /></div>
      </div>
      <label>People</label>
      <div>${b.people.map((p) => `<span class="chip on">${esc(p.name)} <span class="x" title="Remove" onclick="removePerson('${p.id}')">✕</span></span>`).join('')}</div>
      <div class="row">
        <input id="newPerson" placeholder="Add a person…" style="flex:1" />
        <button class="btn small" onclick="addPerson()">Add</button>
      </div>
      <label>Share this bill with the table</label>
      <div class="sharebox">
        <input readonly value="${location.origin}/bill/${b.id}" id="shareLink" />
        <button class="btn small secondary" onclick="copyShare()">Copy link</button>
      </div>
    </div>

    <div class="card">
      <h3>Items</h3>
      ${itemsHtml}
      <h3 style="margin-top:1.2rem">Add from café menu</h3>
      ${menuHtml}
      <label>Custom item</label>
      <div class="row">
        <input id="ciName" placeholder="Name" style="flex:2" />
        <input id="ciPrice" type="number" min="0" step="any" placeholder="KSh" style="flex:1" />
        <button class="btn small" onclick="addCustom()">Add</button>
      </div>
    </div>

    <div class="card">
      <h3>How should we split?</h3>
      <div class="modebar">
        <span class="chip ${b.splitMode === 'equal' ? 'on' : ''}" onclick="saveBill({splitMode:'equal'})">Equally</span>
        <span class="chip ${b.splitMode === 'item' ? 'on' : ''}" onclick="saveBill({splitMode:'item'})">By item</span>
        <span class="chip ${b.splitMode === 'percent' ? 'on' : ''}" onclick="saveBill({splitMode:'percent'})">By percentage</span>
      </div>
      ${b.splitMode === 'equal' ? '<p class="small muted">Everything is divided evenly between everyone.</p>' : ''}
      ${b.splitMode === 'item' ? '<p class="small muted">Tap names on each item above to say who had it. Shared items split between the people tapped.</p>' : ''}
      ${b.splitMode === 'percent' ? `
        ${b.people.map((p) => `
          <div class="row" style="margin:.3rem 0">
            <span style="flex:1">${esc(p.name)}</span>
            <input type="number" min="0" step="any" style="max-width:110px" value="${(b.percentages || {})[p.id] || ''}" placeholder="%" onchange="setPercent('${p.id}', this.value)" />
            <span>%</span>
          </div>`).join('')}
        <p class="small ${pctSum === 100 ? 'muted' : ''}" ${pctSum !== 100 ? 'style="color:#8a6d1a"' : ''}>Total so far: ${pctSum}% ${pctSum === 100 ? '✓' : '— shares are scaled proportionally until they reach 100%.'}</p>` : ''}
      <div class="grid2">
        <div><label>Tip %</label><input type="number" min="0" step="any" value="${b.tipPercent}" onchange="saveBill({tipPercent:Number(this.value)||0})" /></div>
        <div><label>Tax %</label><input type="number" min="0" step="any" value="${b.taxPercent}" onchange="saveBill({taxPercent:Number(this.value)||0})" /></div>
      </div>
      <div class="grid2">
        <div><label>Discount type</label>
          <select onchange="saveBill({discount:{type:this.value, value: current.bill.discount.value}})">
            <option value="percent" ${b.discount.type === 'percent' ? 'selected' : ''}>Percent %</option>
            <option value="amount" ${b.discount.type === 'amount' ? 'selected' : ''}>Amount KSh</option>
          </select>
        </div>
        <div><label>Discount value</label><input type="number" min="0" step="any" value="${b.discount.value}" onchange="saveBill({discount:{type: current.bill.discount.type, value:Number(this.value)||0}})" /></div>
      </div>
      <label>Who paid the café? (for settle up)</label>
      <select onchange="saveBill({payerId: this.value || null})">
        <option value="">— nobody yet —</option>
        ${b.people.map((p) => `<option value="${p.id}" ${b.payerId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>

    <div class="card">
      <h3>Bill summary</h3>
      <table class="totals">
        <tr><td>Subtotal</td><td style="text-align:right">${fmt(c.subtotal)}</td></tr>
        ${c.discountAmount ? `<tr><td>Discount</td><td style="text-align:right">− ${fmt(c.discountAmount)}</td></tr>` : ''}
        ${c.taxAmount ? `<tr><td>Tax</td><td style="text-align:right">${fmt(c.taxAmount)}</td></tr>` : ''}
        ${c.tipAmount ? `<tr><td>Tip</td><td style="text-align:right">${fmt(c.tipAmount)}</td></tr>` : ''}
        <tr><td class="grand">Grand total</td><td class="grand" style="text-align:right">${fmt(c.grandTotal)}</td></tr>
      </table>
    </div>

    <h3>Who owes what</h3>
    ${perPersonHtml || '<p class="muted">Add people to see the split.</p>'}

    ${c.settleUp.length ? `<div class="card">
      <h3>Settle up</h3>
      ${c.settleUp.map((s) => `<div class="settle-line"><span>${esc(s.from)} owes ${esc(s.to)}</span><strong>${fmt(s.amount)} ${s.settled ? '· <span style="color:var(--green)">settled ✓</span>' : ''}</strong></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="row wrap">
        ${b.status === 'open'
          ? `<button class="btn" onclick="closeBill()">Close bill (settle)</button>`
          : `<button class="btn" onclick="reopenCurrent()">Reopen bill</button>`}
        ${customerView ? '' : `<button class="btn secondary" onclick="goHome()">Back to all bills</button>`}
        <button class="btn danger" onclick="deleteBill('${b.id}')">Delete bill</button>
      </div>
    </div>`;
}

function copyShare() {
  const el = document.getElementById('shareLink');
  el.select();
  navigator.clipboard && navigator.clipboard.writeText(el.value);
  alert('Bill link copied: ' + el.value);
}

// ---- bill editing actions ----
async function addPerson() {
  const inp = document.getElementById('newPerson');
  const name = inp.value.trim();
  if (!name) return;
  const people = [...current.bill.people, { id: 'p' + Math.random().toString(16).slice(2, 10), name }];
  await saveBill({ people });
}
async function removePerson(pid) {
  const people = current.bill.people.filter((p) => p.id !== pid);
  await saveBill({ people });
}
async function addFromMenu(mid) {
  const m = menuItems.find((x) => x.id === mid);
  if (!m) return;
  const existing = current.bill.items.find((it) => it.menuItemId === mid);
  let items;
  if (existing) items = current.bill.items.map((it) => (it.id === existing.id ? { ...it, qty: it.qty + 1 } : it));
  else items = [...current.bill.items, { id: 'i' + Math.random().toString(16).slice(2, 10), menuItemId: mid, name: m.name, price: m.price, qty: 1, assignedTo: [] }];
  await saveBill({ items });
}
async function addCustom() {
  const name = document.getElementById('ciName').value.trim();
  const price = Number(document.getElementById('ciPrice').value);
  if (!name || !(price >= 0)) { alert('Give the custom item a name and a price.'); return; }
  const items = [...current.bill.items, { id: 'i' + Math.random().toString(16).slice(2, 10), menuItemId: null, name, price, qty: 1, assignedTo: [] }];
  await saveBill({ items });
}
async function changeQty(itemId, delta) {
  const items = current.bill.items
    .map((it) => (it.id === itemId ? { ...it, qty: it.qty + delta } : it))
    .filter((it) => it.qty > 0);
  await saveBill({ items });
}
async function removeItem(itemId) {
  await saveBill({ items: current.bill.items.filter((it) => it.id !== itemId) });
}
async function toggleAssign(itemId, personId) {
  const items = current.bill.items.map((it) => {
    if (it.id !== itemId) return it;
    const has = it.assignedTo.includes(personId);
    return { ...it, assignedTo: has ? it.assignedTo.filter((x) => x !== personId) : [...it.assignedTo, personId] };
  });
  await saveBill({ items });
}
async function setPercent(personId, value) {
  const percentages = { ...(current.bill.percentages || {}), [personId]: Number(value) || 0 };
  await saveBill({ percentages });
}
async function togglePaid(personId) {
  const paidBy = { ...(current.bill.paidBy || {}), [personId]: !(current.bill.paidBy || {})[personId] };
  await saveBill({ paidBy });
}
async function closeBill() {
  current = await api(`/api/bills/${current.bill.id}/close`, { method: 'POST' });
  renderBill();
}
async function reopenCurrent() {
  current = await api(`/api/bills/${current.bill.id}/reopen`, { method: 'POST' });
  renderBill();
}

// ---------------- café menu (staff) ----------------
async function showMenu() {
  customerView = false;
  history.pushState({}, '', '/app');
  menuItems = (await api('/api/menu')).items;
  const cats = [...new Set(menuItems.map((m) => m.category))];
  app.innerHTML = `
    <div class="card">
      <h2>☕ Café menu</h2>
      <p class="small muted">The café can edit prices and items here. Changes apply to new items added to bills; bills already started keep the price they were added at.${config.staffPinRequired ? ' A staff PIN is required to save changes.' : ''}</p>
      ${cats.map((cat) => `
        <h3>${esc(cat)}</h3>
        ${menuItems.filter((m) => m.category === cat).map((m) => `
          <div class="row" style="margin:.35rem 0">
            <input value="${esc(m.name)}" onchange="updateMenuItem('${m.id}','name',this.value)" style="flex:2" />
            <input type="number" min="0" step="any" value="${m.price}" onchange="updateMenuItem('${m.id}','price',this.value)" style="flex:1" />
            <button class="btn small danger" onclick="deleteMenuItem('${m.id}')">Delete</button>
          </div>`).join('')}`).join('')}
      <h3>Add an item</h3>
      <div class="grid2">
        <div><label>Name</label><input id="nmName" placeholder="e.g. Matcha Affogato" /></div>
        <div><label>Price (KSh)</label><input id="nmPrice" type="number" min="0" step="any" /></div>
      </div>
      <label>Category</label>
      <select id="nmCat">
        <option>Hot Drinks</option><option>Iced Teas &amp; Coffees</option><option>Matcha</option><option>Mojitos</option><option>Milkshakes</option><option>Signature Sandos</option><option>Sweets &amp; More</option><option>Extras</option>
      </select>
      <p><button class="btn" onclick="addMenuItem()">Add to menu</button>
      <button class="btn secondary" onclick="goHome()">Back to bills</button></p>
    </div>`;
}

async function addMenuItem() {
  const name = document.getElementById('nmName').value.trim();
  const price = Number(document.getElementById('nmPrice').value);
  if (!name || !(price >= 0)) { alert('Give the item a name and a price.'); return; }
  try {
    await api('/api/menu', { method: 'POST', body: { name, price, category: document.getElementById('nmCat').value } });
    await showMenu();
  } catch (e) { alert(e.message); }
}
async function updateMenuItem(id, field, value) {
  try {
    await api(`/api/menu/${id}`, { method: 'PUT', body: { [field]: field === 'price' ? Number(value) || 0 : value } });
    menuItems = (await api('/api/menu')).items;
  } catch (e) { alert(e.message); await showMenu(); }
}
async function deleteMenuItem(id) {
  if (!confirm('Remove this item from the menu?')) return;
  try {
    await api(`/api/menu/${id}`, { method: 'DELETE' });
    await showMenu();
  } catch (e) { alert(e.message); }
}

boot();
