const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'clients.json');

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

function getAll() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function getById(id) {
  return getAll().find(c => c.id === id) || null;
}

function save(clients) {
  ensureStorage();
  fs.writeFileSync(DB_FILE, JSON.stringify(clients, null, 2));
}

function add(data) {
  const clients = getAll();
  const newClient = {
    id: crypto.randomUUID(),
    name: data.name,
    phone: data.phone,
    plan: data.plan,
    price: data.price,
    dueDate: data.dueDate,
    status: 'active',
    sentNotifications: [],
    createdAt: new Date().toISOString()
  };
  clients.push(newClient);
  save(clients);
  return newClient;
}

function update(id, data) {
  const clients = getAll();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return null;
  clients[idx] = { ...clients[idx], ...data, updatedAt: new Date().toISOString() };
  save(clients);
  return clients[idx];
}

function remove(id) {
  const clients = getAll();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return false;
  clients.splice(idx, 1);
  save(clients);
  return true;
}

module.exports = { getAll, getById, add, update, remove };
