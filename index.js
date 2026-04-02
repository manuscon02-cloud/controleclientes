const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');

const db = require('./src/database');
const scheduler = require('./src/scheduler');

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WhatsApp Clients ─────────────────────────────────────────────────────────
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const puppeteerArgs = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
  '--single-process', '--disable-gpu'
];

const clients = {
  personal: { instance: null, qr: null, ready: false, label: 'Particular' },
  work:     { instance: null, qr: null, ready: false, label: 'Trabalho'   }
};

function createClient(key) {
  const authPath = process.env.AUTH_DATA_PATH || '/app/data/.wwebjs_auth';
  const c = new Client({
    authStrategy: new LocalAuth({ clientId: key, dataPath: authPath }),
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

  c.on('auth_failure', (msg) => {
    console.error(`❌ Falha na autenticação [${key}]:`, msg);
    clients[key].ready = false;
  });

  c.on('disconnected', (reason) => {
    console.warn(`⚠️  WhatsApp [${key}] desconectado:`, reason);
    clients[key].ready = false;
    setTimeout(() => c.initialize(), 10000);
  });

  clients[key].instance = c;
  c.initialize();
}

createClient('personal');
createClient('work');

// ─── Status ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    personal: {
      status: clients.personal.ready ? 'connected' : clients.personal.qr ? 'qr' : 'loading',
      qr: clients.personal.qr,
      label: 'Particular'
    },
    work: {
      status: clients.work.ready ? 'connected' : clients.work.qr ? 'qr' : 'loading',
      qr: clients.work.qr,
      label: 'Trabalho'
    }
  });
});

// ─── Clientes ─────────────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => res.json(db.getAll()));

app.post('/api/clients', (req, res) => {
  const { name, phone, plan, price, dueDate, sender } = req.body;
  if (!name || !phone || !plan || !price || !dueDate || !sender) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }
  res.json(db.add({ name, phone: phone.replace(/\D/g, ''), plan, price: parseFloat(price), dueDate, sender }));
});

app.put('/api/clients/:id', (req, res) => {
  const updated = db.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json(updated);
});

app.delete('/api/clients/:id', (req, res) => {
  if (!db.remove(req.params.id)) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json({ success: true });
});

app.post('/api/clients/:id/renew', (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const d = new Date(c.dueDate + 'T12:00:00');
  d.setMonth(d.getMonth() + 1);
  res.json(db.update(c.id, { dueDate: d.toISOString().split('T')[0], status: 'active', sentNotifications: [] }));
});

app.post('/api/clients/:id/test', async (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const senderKey = c.sender || 'personal';
  if (!clients[senderKey].ready) {
    return res.status(503).json({ error: `WhatsApp "${clients[senderKey].label}" não está conectado.` });
  }

  try {
    await clients[senderKey].instance.sendMessage(`${c.phone}@c.us`,
      `Olá, *${c.name}*! 👋\nEste é um teste do sistema de cobranças. Tudo funcionando! ✅`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Receita ──────────────────────────────────────────────────────────────────
app.get('/api/revenue', (req, res) => {
  const active = db.getAll().filter(c => c.status === 'active');
  const total = active.reduce((s, c) => s + (c.price || 0), 0);
  const byPlan = {};
  active.forEach(c => { byPlan[c.plan] = (byPlan[c.plan] || 0) + (c.price || 0); });
  res.json({ total, byPlan, activeCount: active.length, totalCount: db.getAll().length });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🌐 Dashboard em http://localhost:${PORT}`));
