const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const db = require('./src/database');
const scheduler = require('./src/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';

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

// ─── Limpar locks do Chromium ─────────────────────────────────────────────────
// Quando o container reinicia, o Chromium deixa arquivos de lock para trás
// que impedem uma nova instância de iniciar. Esta função remove esses locks.
function clearChromiumLocks(authPath) {
  try {
    const baseDir = path.join(authPath);
    if (!fs.existsSync(baseDir)) return;

    // Percorre as pastas de sessão de cada cliente (personal, work)
    const dirs = fs.readdirSync(baseDir);
    for (const dir of dirs) {
      const sessionDir = path.join(baseDir, dir, 'Default');
      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const lf of lockFiles) {
        const lockPath = path.join(sessionDir, lf);
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
          console.log(`🔓 Lock removido: ${lockPath}`);
        }
      }
      // Também verifica na raiz da pasta de sessão
      const rootLocks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const lf of rootLocks) {
        const lockPath = path.join(baseDir, dir, lf);
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
          console.log(`🔓 Lock removido: ${lockPath}`);
        }
      }
    }
  } catch (e) {
    console.log('ℹ️  Nenhum lock para limpar:', e.message);
  }
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
const AUTH_PATH = process.env.AUTH_DATA_PATH || '/app/data/.wwebjs_auth';

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
  '--disable-features=site-per-process'
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
    console.warn(`⚠️  WhatsApp [${key}] desconectado. Reconectando em 20s...`);
    clients[key].ready = false;
    setTimeout(() => {
      clearChromiumLocks(AUTH_PATH);
      c.initialize();
    }, 20000);
  });

  clients[key].instance = c;
  return c;
}

// Limpa locks ANTES de iniciar qualquer cliente
clearChromiumLocks(AUTH_PATH);

// Inicia Particular imediatamente, Trabalho após 25s
console.log('🤖 Iniciando WhatsApp Particular...');
createClient('personal').initialize();

setTimeout(() => {
  console.log('🤖 Iniciando WhatsApp Trabalho...');
  createClient('work').initialize();
}, 25000);

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
