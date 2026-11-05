// lib/store.js — tiny JSON-file data store. No external database service.
//
// State lives in data/store.json (git-ignored). Writes are atomic
// (write to a temp file, then rename) so a crash can't corrupt the store.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

// The café's real menu, mirroring karakandgo.com (Nov 2026).
// Categories are the site's own labels; prices in KSh.
const SEED_MENU = [
  // Hot Drinks
  { id: 'm01', name: 'Karak Tea (Regular)', price: 250, category: 'Hot Drinks' },
  { id: 'm02', name: 'Karak Tea (Large)', price: 350, category: 'Hot Drinks' },
  { id: 'm03', name: 'Hot Chocolate', price: 500, category: 'Hot Drinks' },
  { id: 'm04', name: 'Flat White', price: 450, category: 'Hot Drinks' },
  { id: 'm05', name: 'Americano', price: 400, category: 'Hot Drinks' },
  { id: 'm06', name: 'Cappuccino', price: 450, category: 'Hot Drinks' },
  { id: 'm07', name: 'Spanish Latte', price: 500, category: 'Hot Drinks' },
  { id: 'm08', name: 'Babyccino', price: 420, category: 'Hot Drinks' },
  // Iced Teas & Coffees
  { id: 'm09', name: 'Iced Butterscotch Latte', price: 700, category: 'Iced Teas & Coffees' },
  { id: 'm10', name: 'Iced Tiramisu Latte', price: 750, category: 'Iced Teas & Coffees' },
  { id: 'm11', name: 'The Original Iced Karak', price: 650, category: 'Iced Teas & Coffees' },
  { id: 'm12', name: 'Rose Iced Karak', price: 690, category: 'Iced Teas & Coffees' },
  { id: 'm13', name: 'Iced Americano', price: 400, category: 'Iced Teas & Coffees' },
  { id: 'm14', name: 'Iced Spanish Latte', price: 550, category: 'Iced Teas & Coffees' },
  { id: 'm15', name: 'Iced Brown Sugar Shaken Espresso', price: 500, category: 'Iced Teas & Coffees' },
  { id: 'm16', name: 'Iced Latte', price: 600, category: 'Iced Teas & Coffees' },
  // Matcha
  { id: 'm17', name: 'Mango Matcha', price: 850, category: 'Matcha' },
  { id: 'm18', name: 'Iced Butterscotch Matcha', price: 700, category: 'Matcha' },
  { id: 'm19', name: 'Iced Vanilla Matcha Latte', price: 650, category: 'Matcha' },
  { id: 'm20', name: 'Matcha Max', price: 750, category: 'Matcha' },
  { id: 'm21', name: 'Iced Strawberry Milk Matcha', price: 680, category: 'Matcha' },
  { id: 'm22', name: 'Iced Strawberry Milk Matcha Max', price: 780, category: 'Matcha' },
  { id: 'm23', name: 'Coconut Cloud Matcha', price: 690, category: 'Matcha' },
  { id: 'm24', name: 'Iced Spanish Matcha', price: 680, category: 'Matcha' },
  { id: 'm25', name: 'Maple Leaf Matcha', price: 850, category: 'Matcha' },
  // Mojitos
  { id: 'm26', name: 'Ginger Fizz', price: 450, category: 'Mojitos' },
  { id: 'm27', name: 'Classic Mojito', price: 450, category: 'Mojitos' },
  { id: 'm28', name: 'Strawberry Mojito', price: 450, category: 'Mojitos' },
  { id: 'm29', name: 'Passion Mojito', price: 450, category: 'Mojitos' },
  // Milkshakes
  { id: 'm30', name: 'Vanilla Milkshake', price: 550, category: 'Milkshakes' },
  { id: 'm31', name: 'Espresso Milkshake', price: 550, category: 'Milkshakes' },
  { id: 'm32', name: 'Strawberry Milkshake', price: 680, category: 'Milkshakes' },
  // Signature Sandos
  { id: 'm33', name: 'Shawarma Sliders', price: 1250, category: 'Signature Sandos' },
  { id: 'm34', name: 'K&G Chicken', price: 820, category: 'Signature Sandos' },
  { id: 'm35', name: 'Beef & Cheese', price: 850, category: 'Signature Sandos' },
  { id: 'm36', name: 'Grilled Cheese', price: 450, category: 'Signature Sandos' },
  { id: 'm37', name: 'Egg & Cheese Breakfast Sandwich', price: 550, category: 'Signature Sandos' },
  { id: 'm38', name: 'Veggie Melt', price: 650, category: 'Signature Sandos' },
  // Sweets & More
  { id: 'm39', name: 'Lotus Love', price: 730, category: 'Sweets & More' },
  { id: 'm40', name: 'Pistachio Dream', price: 820, category: 'Sweets & More' },
  { id: 'm41', name: 'Karak Classic Cream', price: 650, category: 'Sweets & More' },
  { id: 'm42', name: 'Banana Pudding', price: 600, category: 'Sweets & More' },
  { id: 'm43', name: 'Nutella Cinnamon Swirl', price: 690, category: 'Sweets & More' },
  { id: 'm44', name: 'Mango Pudding', price: 600, category: 'Sweets & More' },
  { id: 'm45', name: 'Chapati', price: 320, category: 'Sweets & More' },
  { id: 'm46', name: 'Tiraleche', price: 650, category: 'Sweets & More' },
  { id: 'm47', name: 'K&G Cookie', price: 170, category: 'Sweets & More' },
  { id: 'm48', name: 'PB&J Sando', price: 450, category: 'Sweets & More' },
  // Extras
  { id: 'm49', name: 'Extra Premium Syrup', price: 120, category: 'Extras' },
  { id: 'm50', name: 'Milk Alternatives', price: 120, category: 'Extras' },
  { id: 'm51', name: 'Strawberry Cold Foam', price: 150, category: 'Extras' },
  { id: 'm52', name: 'Salted Vanilla Cold Foam', price: 150, category: 'Extras' },
  { id: 'm53', name: 'Extra Shot Espresso', price: 120, category: 'Extras' },
  { id: 'm54', name: 'Extra Matcha', price: 100, category: 'Extras' },
  { id: 'm55', name: 'Extra Vanilla Syrup', price: 80, category: 'Extras' },
  { id: 'm56', name: 'Water', price: 150, category: 'Extras' },
  { id: 'm57', name: 'Sparkling Water', price: 180, category: 'Extras' },
];

// Bump this whenever SEED_MENU changes in a way existing deployments must
// pick up. Stores saved with an older (or missing) menuVersion get their
// menuItems swapped for SEED_MENU exactly once, on load; bills and all
// other state are preserved, and café edits made afterwards are kept.
const MENU_VERSION = 2;

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(state.menuItems) || !Array.isArray(state.bills)) throw new Error('bad store shape');
  } catch (e) {
    state = { menuItems: SEED_MENU.map((m) => ({ ...m })), bills: [], menuVersion: MENU_VERSION };
    save();
    return state;
  }
  // One-time menu migration for stores saved before menuVersion existed.
  if ((state.menuVersion || 0) < MENU_VERSION) {
    state.menuItems = SEED_MENU.map((m) => ({ ...m }));
    state.menuVersion = MENU_VERSION;
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

module.exports = { load, save, uid, SEED_MENU, MENU_VERSION };
