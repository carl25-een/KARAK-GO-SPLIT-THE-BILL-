// lib/store.js — tiny JSON-file data store. No external database service.
//
// State lives in data/store.json (git-ignored). Writes are atomic
// (write to a temp file, then rename) so a crash can't corrupt the store.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

const SEED_MENU = [
  { id: 'm01', name: 'Matcha Latte', price: 450, category: 'Drinks' },
  { id: 'm02', name: 'Iced Matcha Latte', price: 480, category: 'Drinks' },
  { id: 'm03', name: 'Ceremonial Matcha (Usucha)', price: 600, category: 'Drinks' },
  { id: 'm04', name: 'Strawberry Matcha Latte', price: 550, category: 'Drinks' },
  { id: 'm05', name: 'Matcha Espresso Fusion', price: 520, category: 'Drinks' },
  { id: 'm06', name: 'Mango Matcha Cooler', price: 400, category: 'Drinks' },
  { id: 'm07', name: 'Matcha Cheesecake', price: 650, category: 'Desserts' },
  { id: 'm08', name: 'Matcha Tiramisu', price: 700, category: 'Desserts' },
  { id: 'm09', name: 'Matcha Soft Serve', price: 350, category: 'Desserts' },
  { id: 'm10', name: 'Matcha Mochi (3 pc)', price: 300, category: 'Desserts' },
  { id: 'm11', name: 'Matcha Croissant', price: 380, category: 'Food' },
  { id: 'm12', name: 'Chicken Katsu Sando', price: 750, category: 'Food' },
  { id: 'm13', name: 'Extra Matcha Shot', price: 100, category: 'Extras' },
  { id: 'm14', name: 'Oat Milk Upgrade', price: 80, category: 'Extras' },
];

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(state.menuItems) || !Array.isArray(state.bills)) throw new Error('bad store shape');
  } catch (e) {
    state = { menuItems: SEED_MENU.map((m) => ({ ...m })), bills: [] };
    save();
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function uid(prefix) {
  return (prefix || '') + crypto.randomBytes(5).toString('hex');
}

module.exports = { load, save, uid, SEED_MENU };
