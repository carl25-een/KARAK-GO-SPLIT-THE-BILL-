// public/app.js — Matcha Café Split-the-Bill single-page app (vanilla JS, no build step).

let staffPin = sessionStorage.getItem('staffPin') || '';
let config = { staffPinRequired: false };
let menuItems = [];
let billList = [];
let current = null; // { bill, computed }
let customerView = false;

const app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

const PERSON_COLORS = ['#3f7a44', '#b07d3c', '#5b7fa6', '#9a5b8f', '#4d8a7a', '#a6543f', '#6a7f3a', '#5468a8', '#8a6d3b', '#39707e'];
const personColor = (i) => PERSON_COLORS[i % PERSON_COLORS.length];
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

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

// ---------------- toasts ----------------
function toast(msg, type) {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.setAttribute('role', 'status');
  el.innerHTML = (type === 'error' ? '' : '<span class="tick" aria-hidden="true">✓</span>') + esc(msg);
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

// ---------------- confirm modal ----------------
function confirmAction({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <h3 id="modalTitle">${esc(title)}</h3>
          <p>${esc(body)}</p>
          <div class="mrow">
            <button class="btn secondary" id="modalCancel">Cancel</button>
            <button class="btn ${danger ? 'danger solid' : ''}" id="modalConfirm">${esc(confirmLabel || 'Confirm')}</button>
          </div>
        </div>
      </div>`;
    const overlay = document.getElementById('modalOverlay');
    const done = (val) => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    document.getElementById('modalCancel').addEventListener('click', () => done(false));
    document.getElementById('modalConfirm').addEventListener('click', () => done(true));
    (danger ? document.getElementById('modalCancel') : document.getElementById('modalConfirm')).focus();
  });
}

// ---------------- sticky summary bar ----------------
function setStickyBar(html) {
  const bar = document.getElementById('stickybar');
  if (!html) {
    bar.hidden = true;
    bar.innerHTML = '';
    document.body.classList.remove('has-bar');
    return;
  }
  bar.innerHTML = html;
  bar.hidden = false;
  document.body.classList.add('has-bar');
}

function renderStickyBar() {
  if (!current) return setStickyBar(null);
  const b = current.bill;
  const c = current.computed;
  const n = c.perPerson.length;
  const paidCount = c.perPerson.filter((p) => p.paid).length;
  const pct = n ? Math.round((paidCount / n) * 100) : 0;
  setStickyBar(`
    <div class="inner">
      <div>
        <div class="sb-label">Grand total</div>
        <div class="sb-total">${fmt(c.grandTotal)}</div>
      </div>
      <div class="sb-right">
        <div class="sb-paid">${b.status === 'settled' ? 'Settled ✓' : (n ? `${paidCount} of ${n} paid` : 'No people yet')}</div>
        ${n ? `<div class="progress" style="width:min(132px,34vw)"><i style="width:${pct}%"></i></div>` : ''}
      </div>
    </div>`);
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
  history.pushState({}, '', '/');
  current = null;
  setStickyBar(null);
  billList = (await api('/api/bills')).bills;
  renderHome();
}

function billCard(b, settled) {
  return `
    <button class="billcard ${settled ? 'is-settled' : ''}" onclick="openBill('${b.id}')" aria-label="Open bill ${esc(b.occasion || 'Bill')}">
      <div class="grow">
        <div class="btitle">${esc(b.occasion || 'Bill')}${b.table ? ` <span class="muted" style="font-weight:600">· Table ${esc(b.table)}</span>` : ''}</div>
        <div class="bmeta">${b.peopleCount} ${b.peopleCount === 1 ? 'person' : 'people'} · ${new Date(b.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
      </div>
      <div class="bright">
        <div class="total">${fmt(b.grandTotal)}</div>
        <span class="badge ${settled ? 'settled' : ''}">${b.status}</span>
      </div>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
}

function renderHome() {
  const open = billList.filter((b) => b.status === 'open');
  const settled = billList.filter((b) => b.status === 'settled');
  app.innerHTML = `
    <div class="card hero">
      <h2>Start a new bill 🍵</h2>
      <p class="muted small" style="margin:-.3rem 0 .4rem">For a table at the café — split it equally, by item, or by percentage.</p>
      <form onsubmit="createBill(event)">
        <label for="nbOccasion">Occasion</label>
        <input id="nbOccasion" placeholder="e.g. Birthday lunch" autocomplete="off" />
        <div class="grid2">
          <div><label for="nbTable">Table</label><input id="nbTable" placeholder="e.g. 4" autocomplete="off" /></div>
          <div><label for="nbPeople">People</label><input id="nbPeople" placeholder="Amina, Brian, Ciku" autocomplete="off" /></div>
        </div>
        <p class="hint">Separate names with commas. You can add more people later.</p>
        <button class="btn big" type="submit" style="margin-top:.8rem">Start bill <span class="arr" aria-hidden="true">→</span></button>
      </form>
    </div>

    <div class="section-title"><h3>Open bills</h3>${open.length ? `<span class="count">${open.length} open</span>` : ''}</div>
    ${open.length ? open.map((b) => billCard(b, false)).join('') : `
      <div class="empty">
        <span class="eicon" aria-hidden="true">🍵</span>
        <p><strong>No open bills right now.</strong><br />Start one with the form above and you're ready to order.</p>
      </div>`}

    <div class="section-title"><h3>Settled history</h3>${settled.length ? `<span class="count">${settled.length} settled</span>` : ''}</div>
    ${settled.length ? settled.map((b) => `
      ${billCard(b, true)}
      <div class="settled-actions">
        <button class="btn small secondary" onclick="reopenBill('${b.id}')">Reopen</button>
        <button class="btn small danger" onclick="deleteBill('${b.id}')">Delete</button>
      </div>`).join('') : `
      <div class="empty">
        <span class="eicon" aria-hidden="true">🧾</span>
        <p><strong>Nothing settled yet.</strong><br />Closed bills will live here so you can reopen or review them.</p>
      </div>`}`;
}

async function createBill(ev) {
  ev.preventDefault();
  const peopleInput = document.getElementById('nbPeople');
  const people = peopleInput.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (!people.length) {
    peopleInput.classList.add('invalid');
    peopleInput.focus();
    toast('Add at least one person to start the bill.', 'error');
    return;
  }
  peopleInput.classList.remove('invalid');
  try {
    current = await api('/api/bills', {
      method: 'POST',
      body: {
        occasion: document.getElementById('nbOccasion').value,
        table: document.getElementById('nbTable').value,
        people,
      },
    });
    renderBill();
    toast('Bill started — add what the table ordered.');
  } catch (e) { toast(e.message, 'error'); }
}

async function reopenBill(id) {
  try {
    await api(`/api/bills/${id}/reopen`, { method: 'POST' });
    await goHome();
    toast('Bill reopened.');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteBill(id) {
  const ok = await confirmAction({
    title: 'Delete this bill?',
    body: 'The bill and its history will be permanently deleted. This can\'t be undone.',
    confirmLabel: 'Delete bill',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/bills/${id}`, { method: 'DELETE' });
    await goHome();
    toast('Bill deleted.');
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------- bill view ----------------
async function openBill(id) {
  try {
    current = await api(`/api/bills/${id}`);
    renderBill();
  } catch (e) {
    setStickyBar(null);
    app.innerHTML = `
      <div class="card">
        <div class="empty" style="border:none;background:transparent">
          <span class="eicon" aria-hidden="true">🍵</span>
          <p><strong>Bill not found.</strong><br />This bill link may have been deleted. Ask the café for a fresh link.</p>
          ${customerView ? '' : '<button class="btn" onclick="goHome()">Back to all bills</button>'}
        </div>
      </div>`;
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
  const qtyOnBill = {};
  b.items.forEach((it) => { if (it.menuItemId) qtyOnBill[it.menuItemId] = (qtyOnBill[it.menuItemId] || 0) + it.qty; });
  const paidCount = c.perPerson.filter((p) => p.paid).length;

  const itemsHtml = b.items.length ? b.items.map((it) => `
    <div class="billitem">
      <div class="grow">
        <div><span class="iname">${esc(it.name)}</span><span class="iprice">${fmt(it.price)} each</span></div>
        ${b.splitMode === 'item' ? `
          <div class="assign-label" id="assign-${it.id}">Who had this?</div>
          <div role="group" aria-labelledby="assign-${it.id}">${b.people.map((p) => `
            <button class="chip ${it.assignedTo.includes(p.id) ? 'on' : ''}" aria-pressed="${it.assignedTo.includes(p.id)}" onclick="toggleAssign('${it.id}','${p.id}')">${esc(p.name)}</button>`).join('')}
            ${it.assignedTo.length === 0 ? '<span class="shared-pill">Shared by everyone</span>' : ''}
          </div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;flex:none">
        <div class="stepper">
          <button class="stepbtn" onclick="changeQty('${it.id}',-1)" aria-label="One less ${esc(it.name)}">−</button>
          <span class="qty" aria-label="Quantity">${it.qty}</span>
          <button class="stepbtn" onclick="changeQty('${it.id}',1)" aria-label="One more ${esc(it.name)}">+</button>
          <button class="iconbtn" onclick="removeItem('${it.id}')" aria-label="Remove ${esc(it.name)} from bill">✕</button>
        </div>
        <div class="linetotal">${fmt(it.price * it.qty)}</div>
      </div>
    </div>`).join('') : `
    <div class="empty">
      <span class="eicon" aria-hidden="true">🧺</span>
      <p><strong>Nothing on the bill yet.</strong><br />Tap a menu item below to add the table's order.</p>
    </div>`;

  const menuHtml = menuItems.length ? cats.map((cat) => `
    <label>${esc(cat)}</label>
    <div class="menugrid">${menuItems.filter((m) => m.category === cat).map((m) => `
      <button class="tile" onclick="addFromMenu('${m.id}')" aria-label="Add ${esc(m.name)}, ${fmt(m.price)}">
        <span class="plus" aria-hidden="true">+</span>
        <span class="tname">${esc(m.name)}</span>
        <span class="tprice">${fmt(m.price)}</span>
        ${qtyOnBill[m.id] ? `<span class="onbill">×${qtyOnBill[m.id]} on bill</span>` : ''}
      </button>`).join('')}
    </div>`).join('') : '<p class="muted">The menu is empty — staff can add items on the Café menu screen.</p>';

  const perPersonHtml = c.perPerson.map((pp, i) => `
    <div class="card personcard ${pp.paid ? 'paid' : ''}">
      <div class="phead">
        <span class="avatar" style="background:${personColor(i)}" aria-hidden="true">${esc(initials(pp.name))}</span>
        <span class="pname">${esc(pp.name)}</span>
        ${pp.paid ? '<span class="badge paid">Paid</span>' : ''}
        <span class="amt">${fmt(pp.total)}</span>
      </div>
      <div class="breakdown">Items ${fmt(pp.items)}${pp.tax ? ` · Tax ${fmt(pp.tax)}` : ''}${pp.tip ? ` · Tip ${fmt(pp.tip)}` : ''}</div>
      ${pp.lines && pp.lines.length ? `<ul class="lines">${pp.lines.map((l) => `<li>${esc(l.name)} ×${l.qty}${l.sharedWith > 1 ? ` (shared ${l.sharedWith} ways)` : ''} — ${fmt(l.amount)}</li>`).join('')}</ul>` : ''}
      <button class="btn ${pp.paid ? 'secondary' : ''} paidbtn" onclick="togglePaid('${pp.personId}')" aria-pressed="${pp.paid}">${pp.paid ? '✓ Paid — tap to undo' : 'Mark as paid'}</button>
    </div>`).join('');

  const pctSum = b.people.reduce((s, p) => s + ((b.percentages || {})[p.id] || 0), 0);
  const pctWidth = Math.max(0, Math.min(100, pctSum));

  const modeHints = {
    equal: 'Everyone pays the same share of the whole bill.',
    item: 'Tap a name on each item to say who had it. Anything left untapped is shared by everyone.',
    percent: 'Give each person a percentage of the bill — handy when someone is treating the table.',
  };

  app.innerHTML = `
    ${customerView ? `
    <div class="card custbanner">
      <strong>Your shared bill 🍵</strong>
      <p class="small" style="margin:.3rem 0 0">The café shared this bill with your table. Find your name below to see exactly what you owe.</p>
    </div>` : ''}
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div style="min-width:0">
          <h2 style="margin:0;overflow-wrap:anywhere">${esc(b.occasion || 'Bill')}</h2>
          <div class="small muted" style="margin-top:.2rem">Started ${new Date(b.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
        <span class="badge ${b.status === 'settled' ? 'settled' : ''}">${b.status}</span>
      </div>
      <div class="grid2">
        <div><label for="fOccasion">Occasion</label><input id="fOccasion" value="${esc(b.occasion)}" onchange="saveBill({occasion:this.value})" /></div>
        <div><label for="fTable">Table</label><input id="fTable" value="${esc(b.table)}" onchange="saveBill({table:this.value})" /></div>
      </div>
      <label>Who's at the table?</label>
      <div>${b.people.map((p, i) => `
        <span class="chip person on"><span class="avatar" style="background:${personColor(i)};width:24px;height:24px;font-size:.62rem;border:none" aria-hidden="true">${esc(initials(p.name))}</span>${esc(p.name)}<button class="x" onclick="removePerson('${p.id}')" aria-label="Remove ${esc(p.name)}">✕</button></span>`).join('') || '<span class="muted small">No people yet — add the first name below.</span>'}
      </div>
      <div class="row">
        <input id="newPerson" placeholder="Add a person…" style="flex:1;min-width:0" aria-label="New person's name" onkeydown="if(event.key==='Enter'){event.preventDefault();addPerson();}" />
        <button class="btn" onclick="addPerson()">Add</button>
      </div>
      <label for="shareLink">Share this bill with the table</label>
      <div class="sharebox">
        <input readonly value="${location.origin}/bill/${b.id}" id="shareLink" />
        <button class="btn secondary" onclick="copyShare()">Copy link</button>
      </div>
      <p class="hint">Anyone with the link can view this bill and see what they owe.</p>
    </div>

    <div class="card">
      <h3>On the bill</h3>
      ${itemsHtml}
      <h3 style="margin-top:1.3rem">Add from the café menu</h3>
      ${menuHtml}
      <label>Or add a custom item</label>
      <div class="row">
        <input id="ciName" placeholder="Name" style="flex:2;min-width:0" aria-label="Custom item name" />
        <input id="ciPrice" type="number" min="0" step="any" placeholder="KSh" style="flex:1;min-width:0" aria-label="Custom item price in KSh" />
        <button class="btn" onclick="addCustom()">Add</button>
      </div>
    </div>

    <div class="card">
      <h3>How should we split?</h3>
      <div class="segmented" role="group" aria-label="Split mode">
        <button aria-pressed="${b.splitMode === 'equal'}" onclick="saveBill({splitMode:'equal'})">Equally</button>
        <button aria-pressed="${b.splitMode === 'item'}" onclick="saveBill({splitMode:'item'})">By item</button>
        <button aria-pressed="${b.splitMode === 'percent'}" onclick="saveBill({splitMode:'percent'})">By %</button>
      </div>
      <div class="modehint"><span class="dot" aria-hidden="true">●</span><span>${modeHints[b.splitMode]}</span></div>
      ${b.splitMode === 'percent' ? `
        ${b.people.map((p) => `
          <div class="row" style="margin:.35rem 0">
            <span style="flex:1;min-width:0;font-weight:600">${esc(p.name)}</span>
            <input type="number" min="0" step="any" style="max-width:110px" value="${(b.percentages || {})[p.id] || ''}" placeholder="0" aria-label="${esc(p.name)}'s percentage" onchange="setPercent('${p.id}', this.value)" />
            <span aria-hidden="true">%</span>
          </div>`).join('')}
        <div class="progress-row">
          <div class="progress"><i style="width:${pctWidth}%"></i></div>
          <strong>${pctSum}%</strong>
        </div>
        ${pctSum === 100
          ? '<p class="oknote">✓ Percentages add up to 100%.</p>'
          : `<p class="warn">Total so far is ${pctSum}% — until it reaches 100%, everyone's share is scaled proportionally.</p>`}` : ''}
      <div class="grid2">
        <div><label for="fTip">Tip %</label><input id="fTip" type="number" min="0" step="any" value="${b.tipPercent}" onchange="saveBill({tipPercent:Number(this.value)||0})" /></div>
        <div><label for="fTax">Tax %</label><input id="fTax" type="number" min="0" step="any" value="${b.taxPercent}" onchange="saveBill({taxPercent:Number(this.value)||0})" /></div>
      </div>
      <div class="grid2">
        <div><label for="fDiscType">Discount type</label>
          <select id="fDiscType" onchange="saveBill({discount:{type:this.value, value: current.bill.discount.value}})">
            <option value="percent" ${b.discount.type === 'percent' ? 'selected' : ''}>Percent %</option>
            <option value="amount" ${b.discount.type === 'amount' ? 'selected' : ''}>Amount KSh</option>
          </select>
        </div>
        <div><label for="fDiscVal">Discount value</label><input id="fDiscVal" type="number" min="0" step="any" value="${b.discount.value}" onchange="saveBill({discount:{type: current.bill.discount.type, value:Number(this.value)||0}})" /></div>
      </div>
      <label for="fPayer">Who paid the café? (for settle up)</label>
      <select id="fPayer" onchange="saveBill({payerId: this.value || null})">
        <option value="">— nobody yet —</option>
        ${b.people.map((p) => `<option value="${p.id}" ${b.payerId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>

    <div class="card">
      <h3>Bill summary</h3>
      <table class="totals">
        <tr><td>Subtotal</td><td class="num">${fmt(c.subtotal)}</td></tr>
        ${c.discountAmount ? `<tr><td>Discount</td><td class="num">− ${fmt(c.discountAmount)}</td></tr>` : ''}
        ${c.taxAmount ? `<tr><td>Tax</td><td class="num">${fmt(c.taxAmount)}</td></tr>` : ''}
        ${c.tipAmount ? `<tr><td>Tip</td><td class="num">${fmt(c.tipAmount)}</td></tr>` : ''}
        <tr><td class="grand">Grand total</td><td class="grand num">${fmt(c.grandTotal)}</td></tr>
      </table>
      ${c.perPerson.length ? `
      <div class="progress-row">
        <div class="progress"><i style="width:${Math.round((paidCount / c.perPerson.length) * 100)}%"></i></div>
        <span class="small" style="font-weight:700;white-space:nowrap">${paidCount} of ${c.perPerson.length} paid</span>
      </div>` : ''}
    </div>

    <div class="section-title"><h3>Who owes what</h3>${c.perPerson.length ? `<span class="count">${paidCount}/${c.perPerson.length} paid</span>` : ''}</div>
    ${perPersonHtml || `
      <div class="empty">
        <span class="eicon" aria-hidden="true">👥</span>
        <p><strong>No people on this bill yet.</strong><br />Add who's at the table above and the split will appear here.</p>
      </div>`}

    ${c.settleUp.length ? `<div class="card">
      <h3>Settle up</h3>
      <p class="hint" style="margin:-.25rem 0 .4rem">One person covered the café — here's who owes them back.</p>
      ${c.settleUp.map((s) => `<div class="settle-line"><span>${esc(s.from)} owes ${esc(s.to)}</span><strong>${fmt(s.amount)}${s.settled ? ' · <span class="settled-yes">settled ✓</span>' : ''}</strong></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="row wrap">
        ${b.status === 'open'
          ? `<button class="btn" onclick="closeBill()">Close bill (settle)</button>`
          : `<button class="btn" onclick="reopenCurrent()">Reopen bill</button>`}
        ${customerView ? '' : `<button class="btn secondary" onclick="goHome()">Back to all bills</button>`}
      </div>
      <div style="margin-top:.9rem">
        <button class="btn danger" onclick="deleteBill('${b.id}')">Delete bill</button>
      </div>
    </div>`;

  renderStickyBar();
}

async function copyShare() {
  const el = document.getElementById('shareLink');
  const link = el.value;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(link);
    else { el.select(); document.execCommand('copy'); }
    toast('Bill link copied — send it to your table.');
  } catch (e) {
    el.select();
    toast('Copy this link: ' + link);
  }
}

// ---- bill editing actions ----
async function addPerson() {
  const inp = document.getElementById('newPerson');
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  const people = [...current.bill.people, { id: 'p' + Math.random().toString(16).slice(2, 10), name }];
  await saveBill({ people });
  toast(name + ' added to the bill.');
}
async function removePerson(pid) {
  const person = current.bill.people.find((p) => p.id === pid);
  const ok = await confirmAction({
    title: 'Remove ' + (person ? person.name : 'this person') + '?',
    body: 'They will be taken off this bill and the split will be recalculated without them.',
    confirmLabel: 'Remove person',
    danger: true,
  });
  if (!ok) return;
  await saveBill({ people: current.bill.people.filter((p) => p.id !== pid) });
  toast((person ? person.name : 'Person') + ' removed.');
}
async function addFromMenu(mid) {
  const m = menuItems.find((x) => x.id === mid);
  if (!m) return;
  const existing = current.bill.items.find((it) => it.menuItemId === mid);
  let items;
  if (existing) items = current.bill.items.map((it) => (it.id === existing.id ? { ...it, qty: it.qty + 1 } : it));
  else items = [...current.bill.items, { id: 'i' + Math.random().toString(16).slice(2, 10), menuItemId: mid, name: m.name, price: m.price, qty: 1, assignedTo: [] }];
  await saveBill({ items });
  toast(m.name + ' added.');
}
async function addCustom() {
  const nameEl = document.getElementById('ciName');
  const priceEl = document.getElementById('ciPrice');
  const name = nameEl.value.trim();
  const price = Number(priceEl.value);
  if (!name || !(price >= 0) || priceEl.value === '') {
    toast('Give the custom item a name and a price.', 'error');
    (name ? priceEl : nameEl).focus();
    return;
  }
  const items = [...current.bill.items, { id: 'i' + Math.random().toString(16).slice(2, 10), menuItemId: null, name, price, qty: 1, assignedTo: [] }];
  await saveBill({ items });
  toast(name + ' added.');
}
async function changeQty(itemId, delta) {
  const it = current.bill.items.find((x) => x.id === itemId);
  if (!it) return;
  if (it.qty + delta <= 0) {
    const ok = await confirmAction({
      title: 'Remove ' + it.name + '?',
      body: 'This takes the item off the bill completely.',
      confirmLabel: 'Remove item',
      danger: true,
    });
    if (!ok) return;
  }
  const items = current.bill.items
    .map((x) => (x.id === itemId ? { ...x, qty: x.qty + delta } : x))
    .filter((x) => x.qty > 0);
  await saveBill({ items });
}
async function removeItem(itemId) {
  const it = current.bill.items.find((x) => x.id === itemId);
  const ok = await confirmAction({
    title: 'Remove ' + (it ? it.name : 'this item') + '?',
    body: 'This takes the item off the bill completely.',
    confirmLabel: 'Remove item',
    danger: true,
  });
  if (!ok) return;
  await saveBill({ items: current.bill.items.filter((x) => x.id !== itemId) });
  toast('Item removed.');
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
  const nowPaid = !(current.bill.paidBy || {})[personId];
  const paidBy = { ...(current.bill.paidBy || {}), [personId]: nowPaid };
  await saveBill({ paidBy });
  const person = current.bill.people.find((p) => p.id === personId);
  toast((person ? person.name : 'Person') + (nowPaid ? ' marked as paid. 🎉' : ' marked as not paid.'));
}
async function closeBill() {
  const ok = await confirmAction({
    title: 'Close this bill?',
    body: `The grand total is ${fmt(current.computed.grandTotal)}. The bill moves to settled history — you can reopen it later if needed.`,
    confirmLabel: 'Close bill',
  });
  if (!ok) return;
  current = await api(`/api/bills/${current.bill.id}/close`, { method: 'POST' });
  renderBill();
  toast('Bill closed and saved to settled history.');
}
async function reopenCurrent() {
  current = await api(`/api/bills/${current.bill.id}/reopen`, { method: 'POST' });
  renderBill();
  toast('Bill reopened.');
}

// ---------------- café menu (staff) ----------------
async function showMenu() {
  customerView = false;
  setStickyBar(null);
  document.getElementById('mainNav').style.display = '';
  history.pushState({}, '', '/');
  menuItems = (await api('/api/menu')).items;
  const cats = [...new Set(menuItems.map((m) => m.category))];
  app.innerHTML = `
    <div class="card">
      <h2>Café menu ☕</h2>
      <p class="small muted" style="margin-top:-.3rem">Edit prices and items here. Changes apply to new items added to bills — bills already started keep the price they were added at.${config.staffPinRequired ? ' A staff PIN is required to save changes.' : ''}</p>
      ${cats.length ? cats.map((cat) => `
        <h3>${esc(cat)}</h3>
        ${menuItems.filter((m) => m.category === cat).map((m) => `
          <div class="menuedit-row">
            <input class="nm" value="${esc(m.name)}" aria-label="Item name" onchange="updateMenuItem('${m.id}','name',this.value)" />
            <input class="pr" type="number" min="0" step="any" value="${m.price}" aria-label="Price in KSh" onchange="updateMenuItem('${m.id}','price',this.value)" />
            <button class="btn small danger" onclick="deleteMenuItem('${m.id}')">Delete</button>
          </div>`).join('')}`).join('') : `
        <div class="empty">
          <span class="eicon" aria-hidden="true">📋</span>
          <p><strong>The menu is empty.</strong><br />Add your first item below.</p>
        </div>`}
      <h3>Add an item</h3>
      <div class="grid2">
        <div><label for="nmName">Name</label><input id="nmName" placeholder="e.g. Matcha Affogato" /></div>
        <div><label for="nmPrice">Price (KSh)</label><input id="nmPrice" type="number" min="0" step="any" /></div>
      </div>
      <label for="nmCat">Category</label>
      <select id="nmCat">
        <option>Drinks</option><option>Desserts</option><option>Food</option><option>Extras</option>
      </select>
      <div class="row wrap" style="margin-top:1rem">
        <button class="btn" onclick="addMenuItem()">Add to menu</button>
        <button class="btn secondary" onclick="goHome()">Back to bills</button>
      </div>
    </div>`;
}

async function addMenuItem() {
  const nameEl = document.getElementById('nmName');
  const priceEl = document.getElementById('nmPrice');
  const name = nameEl.value.trim();
  const price = Number(priceEl.value);
  if (!name || !(price >= 0) || priceEl.value === '') {
    toast('Give the item a name and a price.', 'error');
    (name ? priceEl : nameEl).focus();
    return;
  }
  try {
    await api('/api/menu', { method: 'POST', body: { name, price, category: document.getElementById('nmCat').value } });
    await showMenu();
    toast(name + ' added to the menu.');
  } catch (e) { toast(e.message, 'error'); }
}
async function updateMenuItem(id, field, value) {
  try {
    await api(`/api/menu/${id}`, { method: 'PUT', body: { [field]: field === 'price' ? Number(value) || 0 : value } });
    menuItems = (await api('/api/menu')).items;
    toast('Menu saved.');
  } catch (e) { toast(e.message, 'error'); await showMenu(); }
}
async function deleteMenuItem(id) {
  const item = menuItems.find((m) => m.id === id);
  const ok = await confirmAction({
    title: 'Remove ' + (item ? item.name : 'this item') + '?',
    body: 'It will disappear from the café menu. Bills that already include it keep it.',
    confirmLabel: 'Remove item',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/menu/${id}`, { method: 'DELETE' });
    await showMenu();
    toast('Removed from the menu.');
  } catch (e) { toast(e.message, 'error'); }
}

boot();
