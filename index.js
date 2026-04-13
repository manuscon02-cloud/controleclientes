const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

const db = require('./src/database');
const scheduler = require('./src/scheduler');
const backup = require('./src/backup');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const AUTH_PATH = process.env.AUTH_DATA_PATH || '/app/data/.wwebjs_auth';
const DATA_DIR = '/app/data';

app.use(express.json());

/* ================= IMPORT ================= */
function importDataIfNeeded() {
  try {
    const srcClients = '/app/seeddata/clients.json';
    const srcServers = '/app/seeddata/servers.json';
    const dstClients = path.join(DATA_DIR, 'clients.json');
    const dstServers = path.join(DATA_DIR, 'servers.json');

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(srcClients) && (!fs.existsSync(dstClients) || process.env.FORCE_IMPORT === 'true')) {
      fs.copyFileSync(srcClients, dstClients);
    }
    if (fs.existsSync(srcServers) && (!fs.existsSync(dstServers) || process.env.FORCE_IMPORT === 'true')) {
      fs.copyFileSync(srcServers, dstServers);
    }
  } catch (e) {}
}
importDataIfNeeded();

/* ================= AUTH ================= */
const sessions = new Set();

function authMiddleware(req, res, next) {
  if (req.path === '/api/login') return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token && sessions.has(token)) return next();
  if (!req.path.startsWith('/api/')) return next();
  return res.status(401).json({ error: 'Não autorizado.' });
}

app.use(authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  setTimeout(() => sessions.delete(token), 24 * 60 * 60 * 1000);
  res.json({ token });
});

/* ================= LIMPEZA ================= */
function cleanupChromium() {
  try { execSync('pkill -9 -f chromium 2>/dev/null || true'); } catch (_) {}
  try { execSync('pkill -9 -f chrome 2>/dev/null || true'); } catch (_) {}
}

/* ================= WHATSAPP ================= */
const clients = {
  personal: { instance: null, qr: null, ready: false },
  work: { instance: null, qr: null, ready: false }
};

const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};

function createClient(key) {
  const c = new Client({
    authStrategy: new LocalAuth({ clientId: key, dataPath: AUTH_PATH }),
    puppeteer: puppeteerOptions
  });

  c.on('qr', async (qr) => {
    clients[key].qr = await qrcode.toDataURL(qr);
    clients[key].ready = false;
  });

  c.on('ready', () => {
    console.log(`✅ ${key} conectado`);
    clients[key].ready = true;
    scheduler.startPartial(clients);
  });

  c.on('disconnected', () => {
    clients[key].ready = false;
    setTimeout(() => {
      cleanupChromium();
      c.initialize();
    }, 20000);
  });

  clients[key].instance = c;
  return c;
}

createClient('work').initialize();

/* ================= CLIENTES ================= */
app.get('/api/clients', (req, res) => res.json(db.getAll()));

app.post('/api/clients', (req, res) => {
  const { name, phone, plan, price, dueDate, sender, serverId, credits } = req.body;

  const safeCredits = (parseInt(credits) > 3) ? 1 : (parseInt(credits) || 1);

  const newClient = db.add({
    name,
    phone,
    plan,
    price,
    dueDate,
    sender,
    serverId,
    credits: safeCredits
  });

  res.json(newClient);
});

/* ================= RECEITA CORRIGIDA ================= */
app.get('/api/revenue', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const all = db.getAll();
  const active = all.filter(c => c.status === 'active' && c.dueDate >= today);
  const servers = db.getServers();

  function getMonthlyValue(c) {
    const plan = (c.plan || '').toLowerCase();

    if (plan.includes('trimestral')) return c.price / 3;
    if (plan.includes('semestral')) return c.price / 6;
    if (plan.includes('anual')) return c.price / 12;

    return c.price;
  }

  function getCredits(c) {
    const cr = parseInt(c.credits) || 1;
    return cr > 3 ? 1 : cr;
  }

  const revenue = active.reduce((s, c) => s + getMonthlyValue(c), 0);

  const totalCost = active.reduce((s, c) => {
    const sv = servers.find(x => x.id === c.serverId);
    return s + (sv ? sv.costPerCredit * getCredits(c) : 0);
  }, 0);

  res.json({
    revenue,
    totalCost,
    profit: revenue - totalCost,
    activeCount: active.length
  });
});

/* ================= START ================= */
backup.startBackupScheduler();

app.listen(PORT, () => console.log(`🌐 Rodando em ${PORT}`));
