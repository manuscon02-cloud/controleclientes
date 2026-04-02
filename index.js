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

// ─── Limpeza Chromium ─────────────────────────────────────────────────────────
function cleanupChromium() {
  console.log('🧹 Limpando processos e locks do Chromium...');
  try { execSync('pkill -9 -f chromium 2>/dev/null || true', { stdio: 'ignore' }); } catch(_) {}
  try { execSync('pkill -9 -f chrome 2>/dev/null || true',   { stdio: 'ignore' }); } catch(_) {}
  try { execSync('sleep 1'); } catch(_) {}
  function deleteLocks(dir) {
    if (!fs.existsSync(dir)) return;
    let items; try { items = fs.readdirSync(dir); } catch(_) { return; }
    for (const item of items) {
      const full = path.join(dir, item);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) deleteLocks(full);
        else if (['SingletonLock','SingletonSocket','SingletonCookie','lockfile','.parentlock'].includes(item)) {
          fs.unlinkSync(full); console.log(`🔓 Lock removido: ${full}`);
        }
      } catch(_) {}
    }
  }
  deleteLocks('/app/data'); deleteLocks('/tmp');
  console.log('✅ Limpeza concluída.');
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
const puppeteerArgs = [
  '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
  '--disable-gpu','--disable-extensions','--disable-background-networking',
  '--disable-features=site-per-process,TranslateUI','--disable-ipc-flooding-protection'
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
  c.on('qr', async (qr) => { clients[key].qr = await qrcode.toDataURL(qr); clients[key].ready = false; });
  c.on('ready', () => { console.log(`✅ [${key}] conectado!`); clients[key].ready = true; clients[key].qr = null; scheduler.startPartial(clients); });
  c.on('auth_failure', () => { clients[key].ready = false; });
  c.on('disconnected', () => {
    clients[key].ready = false;
    setTimeout(() => { cleanupChromium(); c.initialize(); }, 20000);
  });
  clients[key].instance = c;
  return c;
}

cleanupChromium();
console.log('🤖 Iniciando WhatsApp Particular...');
createClient('personal').initialize();
setTimeout(() => { console.log('🤖 Iniciando WhatsApp Trabalho...'); createClient('work').initialize(); }, 30000);

// ─── Status ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({
  personal: { status: clients.personal.ready?'connected':clients.personal.qr?'qr':'loading', qr: clients.personal.qr, label:'Particular' },
  work:     { status: clients.work.ready?'connected':clients.work.qr?'qr':'loading',         qr: clients.work.qr,     label:'Trabalho'   }
}));

// ─── Servidores ───────────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => res.json(db.getServers()));

app.post('/api/servers', (req, res) => {
  const { name, costPerCredit, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  res.json(db.addServer({ name, costPerCredit, notes }));
});

app.put('/api/servers/:id', (req, res) => {
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
  const { name, phone, plan, price, dueDate, sender, serverId, credits } = req.body;
  if (!name || !phone || !plan || !price || !dueDate || !sender)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  res.json(db.add({ name, phone: phone.replace(/\D/g,''), plan, price: parseFloat(price), dueDate, sender, serverId, credits: parseInt(credits)||1 }));
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
  res.json(db.update(c.id, { dueDate: d.toISOString().split('T')[0], status:'active', sentNotifications:[] }));
});

app.post('/api/clients/:id/test', async (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Não encontrado.' });
  const key = c.sender || 'personal';
  if (!clients[key].ready) return res.status(503).json({ error: `WhatsApp "${clients[key].label}" não conectado.` });
  try {
    await clients[key].instance.sendMessage(`${c.phone}@c.us`, `Olá, *${c.name}*! 👋\nEste é um teste do sistema de cobranças. Tudo funcionando! ✅`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Receita ──────────────────────────────────────────────────────────────────
app.get('/api/revenue', (req, res) => {
  const active  = db.getAll().filter(c => c.status === 'active');
  const servers = db.getServers();
  const revenue = active.reduce((s, c) => s + (c.price || 0), 0);
  const totalCost = active.reduce((s, c) => {
    const sv = servers.find(x => x.id === c.serverId);
    return s + (sv ? sv.costPerCredit * (c.credits || 1) : 0);
  }, 0);
  res.json({ revenue, totalCost, profit: revenue - totalCost, activeCount: active.length, totalCount: db.getAll().length });
});

// ─── Debug (remover depois de recuperar dados) ────────────────────────────────
app.get('/api/debug', (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Não autorizado.' });
  try {
    const files = {};
    const dirs = ['/app/data', './data', '/app/data/.wwebjs_auth'];
    dirs.forEach(dir => {
      if (fs.existsSync(dir)) {
        try { files[dir] = fs.readdirSync(dir); } catch(e) { files[dir] = 'erro: ' + e.message; }
      } else {
        files[dir] = 'não existe';
      }
    });
    // Tenta ler clients.json de vários caminhos
    const paths = ['/app/data/clients.json', './data/clients.json'];
    const clientsData = {};
    paths.forEach(p => {
      if (fs.existsSync(p)) {
        try { clientsData[p] = JSON.parse(fs.readFileSync(p,'utf8')); } catch(e) { clientsData[p] = 'erro: '+e.message; }
      } else {
        clientsData[p] = 'arquivo não encontrado';
      }
    });
    res.json({ dirs: files, clientsFiles: clientsData });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🌐 Dashboard em http://localhost:${PORT}`));
