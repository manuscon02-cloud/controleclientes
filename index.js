const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

const db = require('./src/database');
const scheduler = require('./src/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const AUTH_PATH = process.env.AUTH_DATA_PATH || '/app/data/.wwebjs_auth';

app.use(express.json());

// ─── Auth ─────────────────────────────────────────────────────────────────────
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

// ─── Limpeza de Chromium ──────────────────────────────────────────────────────
function cleanupChromium() {
  console.log('🧹 Limpando processos e locks do Chromium...');

  // 1. Mata qualquer processo Chromium travado de deploys anteriores
  try { execSync('pkill -9 -f chromium 2>/dev/null || true', { stdio: 'ignore' }); } catch(_) {}
  try { execSync('pkill -9 -f chrome 2>/dev/null || true',   { stdio: 'ignore' }); } catch(_) {}

  // Aguarda 1s para garantir que os processos morreram
  try { execSync('sleep 1'); } catch(_) {}

  // 2. Remove locks recursivamente em todo /app/data
  function deleteLocks(dir) {
    if (!fs.existsSync(dir)) return;
    let items;
    try { items = fs.readdirSync(dir); } catch(_) { return; }
    for (const item of items) {
      const full = path.join(dir, item);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) {
          deleteLocks(full);
        } else if (['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile', '.parentlock'].includes(item)) {
          fs.unlinkSync(full);
          console.log(`🔓 Lock removido: ${full}`);
        }
      } catch(_) {}
    }
  }

  deleteLocks('/app/data');
  deleteLocks('/tmp');

  console.log('✅ Limpeza concluída.');
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const puppeteerArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-features=site-per-process,TranslateUI',
  '--disable-ipc-flooding-protection'
];

const clients = {
  personal: { instance: null, qr: null, ready: false, label: 'Particular' },
  work:     { instance: null, qr: null, ready: false, label: 'Trabalho'   }
};

function createClient(key) {
  const c = new Client({
    authStrategy: new LocalAuth({ clientId: key, dataPath: AUTH_PATH }),
    puppeteer: { executablePath, args: puppeteerArgs, headless: true }
  });

  c.on('qr', async (qr) => {
    console.log(`📱 QR Code gerado para [${key}]`);
    clients[key].qr = await qrcode.toDataURL(qr);
    clients[key].ready = false;
  });

  c.on('ready', () => {
    console.log(`✅ WhatsApp [${key}] conectado!`);
    clients[key].ready = true;
    clients[key].qr = null;
    scheduler.startPartial(clients);
  });

  c.on('auth_failure', () => {
    console.error(`❌ Falha na autenticação [${key}]`);
    clients[key].ready = false;
  });

  c.on('disconnected', () => {
    console.warn(`⚠️  [${key}] desconectado. Limpando e reconectando em 20s...`);
    clients[key].ready = false;
    setTimeout(() => {
      cleanupChromium();
      c.initialize();
    }, 20000);
  });

  clients[key].instance = c;
  return c;
}

// Limpa tudo antes de iniciar
cleanupChromium();

// Inicia Particular imediatamente, Trabalho após 30s
console.log('🤖 Iniciando WhatsApp Particular...');
createClient('personal').initialize();

setTimeout(() => {
  console.log('🤖 Iniciando WhatsApp Trabalho...');
  createClient('work').initialize();
}, 30000);

// ─── Status ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    personal: { status: clients.personal.ready ? 'connected' : clients.personal.qr ? 'qr' : 'loading', qr: clients.personal.qr, label: 'Particular' },
    work:     { status: clients.work.ready     ? 'connected' : clients.work.qr     ? 'qr' : 'loading', qr: clients.work.qr,     label: 'Trabalho'   }
  });
});

// ─── Servidores ───────────────────────────────────────────────────────────────
app.get('/api/servers',        (req, res) => res.json(db.getServers()));
app.post('/api/servers',       (req, res) => {
  const { name, cost, credits, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  res.json(db.addServer({ name, cost, credits, notes }));
});
app.put('/api/servers/:id',    (req, res) => {
  const u = db.updateServer(req.params.id, req.body);
  if (!u) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(u);
});
app.delete('/api/servers/:id', (req, res) => {
  if (!db.removeServer(req.params.id)) return res.status(404).json({ error: 'Não encontrado.' });
  res.json({ success: true });
});

// ─── Clientes ─────────────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => res.json(db.getAll()));

app.post('/api/clients', (req, res) => {
  const { name, phone, plan, price, dueDate, sender, serverId } = req.body;
  if (!name || !phone || !plan || !price || !dueDate || !sender)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  res.json(db.add({ name, phone: phone.replace(/\D/g, ''), plan, price: parseFloat(price), dueDate, sender, serverId }));
});

app.put('/api/clients/:id', (req, res) => {
  const u = db.update(req.params.id, req.body);
  if (!u) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(u);
});

app.delete('/api/clients/:id', (req, res) => {
  if (!db.remove(req.params.id)) return res.status(404).json({ error: 'Não encontrado.' });
  res.json({ success: true });
});

app.post('/api/clients/:id/renew', (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Não encontrado.' });
  const d = new Date(c.dueDate + 'T12:00:00');
  d.setMonth(d.getMonth() + 1);
  res.json(db.update(c.id, { dueDate: d.toISOString().split('T')[0], status: 'active', sentNotifications: [] }));
});

app.post('/api/clients/:id/test', async (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Não encontrado.' });
  const key = c.sender || 'personal';
  if (!clients[key].ready) return res.status(503).json({ error: `WhatsApp "${clients[key].label}" não está conectado.` });
  try {
    await clients[key].instance.sendMessage(`${c.phone}@c.us`, `Olá, *${c.name}*! 👋\nEste é um teste do sistema de cobranças. Tudo funcionando! ✅`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Receita ──────────────────────────────────────────────────────────────────
app.get('/api/revenue', (req, res) => {
  const active = db.getAll().filter(c => c.status === 'active');
  const servers = db.getServers();
  const revenue = active.reduce((s, c) => s + (c.price || 0), 0);
  const totalCost = servers.reduce((s, sv) => s + (sv.cost || 0), 0);
  const byServer = {};
  active.forEach(c => {
    const sv = servers.find(s => s.id === c.serverId);
    const label = sv ? sv.name : 'Sem servidor';
    byServer[label] = (byServer[label] || 0) + (c.price || 0);
  });
  res.json({ revenue, totalCost, profit: revenue - totalCost, byServer, activeCount: active.length, totalCount: db.getAll().length });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🌐 Dashboard em http://localhost:${PORT}`));
