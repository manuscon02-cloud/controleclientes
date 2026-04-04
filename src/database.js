const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Caminho fixo do volume no Railway
const DATA_DIR = '/app/data';
const DB_FILE      = path.join(DATA_DIR, 'clients.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE))      fs.writeFileSync(DB_FILE,      JSON.stringify([], null, 2));
  if (!fs.existsSync(SERVERS_FILE)) fs.writeFileSync(SERVERS_FILE, JSON.stringify([], null, 2));
}

function getAll() {
  ensureStorage();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}
function getById(id) { return getAll().find(c => c.id === id) || null; }
function saveClients(data) { ensureStorage(); fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

function add(data) {
  const clients = getAll();
  const c = {
    id: crypto.randomUUID(),
    name: data.name,
    phone: data.phone,
    plan: data.plan,
    price: data.price,
    dueDate: data.dueDate,
    sender: data.sender,
    serverId: data.serverId || null,
    credits: parseInt(data.credits) || 1,
    status: 'active',
    sentNotifications: [],
    notes: data.notes || '',
    createdAt: new Date().toISOString()
  };
  clients.push(c);
  saveClients(clients);
  return c;
}

function update(id, data) {
  const clients = getAll();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return null;
  clients[idx] = { ...clients[idx], ...data, updatedAt: new Date().toISOString() };
  saveClients(clients);
  return clients[idx];
}

function remove(id) {
  const clients = getAll();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return false;
  clients.splice(idx, 1);
  saveClients(clients);
  return true;
}

function getServers() {
  ensureStorage();
  try { return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8')); } catch { return []; }
}
function saveServers(data) { ensureStorage(); fs.writeFileSync(SERVERS_FILE, JSON.stringify(data, null, 2)); }

function addServer(data) {
  const servers = getServers();
  const s = {
    id: crypto.randomUUID(),
    name: data.name,
    costPerCredit: parseFloat(data.costPerCredit) || 0,
    notes: data.notes || '',
    createdAt: new Date().toISOString()
  };
  servers.push(s);
  saveServers(servers);
  return s;
}

function updateServer(id, data) {
  const servers = getServers();
  const idx = servers.findIndex(s => s.id === id);
  if (idx === -1) return null;
  servers[idx] = { ...servers[idx], ...data, updatedAt: new Date().toISOString() };
  saveServers(servers);
  return servers[idx];
}

function removeServer(id) {
  const servers = getServers();
  const idx = servers.findIndex(s => s.id === id);
  if (idx === -1) return false;
  servers.splice(idx, 1);
  saveServers(servers);
  return true;
}

// Loga o caminho na inicialização para debug
console.log(`📂 Database path: ${DATA_DIR}`);
console.log(`📋 clients.json existe: ${fs.existsSync(DB_FILE)}`);
console.log(`🖥️  servers.json existe: ${fs.existsSync(SERVERS_FILE)}`);

module.exports = { getAll, getById, add, update, remove, getServers, addServer, updateServer, removeServer };
