const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');

const db = require('./src/database');
const scheduler = require('./src/scheduler');

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WhatsApp Client ──────────────────────────────────────────────────────────
let qrCodeData = null;
let botReady = false;

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.AUTH_DATA_PATH || '.wwebjs_auth' }),
  puppeteer: {
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    headless: true
  }
});

client.on('qr', async (qr) => {
  console.log('📱 QR Code gerado. Acesse o dashboard para escanear.');
  qrCodeData = await qrcode.toDataURL(qr);
  botReady = false;
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado com sucesso!');
  botReady = true;
  qrCodeData = null;
  scheduler.start(client);
});

client.on('auth_failure', (msg) => {
  console.error('❌ Falha na autenticação:', msg);
  botReady = false;
});

client.on('disconnected', (reason) => {
  console.warn('⚠️  WhatsApp desconectado:', reason);
  botReady = false;
  // Tenta reconectar após 10s
  setTimeout(() => client.initialize(), 10000);
});

// ─── Rotas de Status ──────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  if (botReady) return res.json({ status: 'connected' });
  if (qrCodeData) return res.json({ status: 'qr', qr: qrCodeData });
  return res.json({ status: 'loading' });
});

// ─── Rotas de Clientes ────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => {
  res.json(db.getAll());
});

app.post('/api/clients', (req, res) => {
  const { name, phone, plan, price, dueDate } = req.body;
  if (!name || !phone || !plan || !price || !dueDate) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }
  const newClient = db.add({ name, phone: phone.replace(/\D/g, ''), plan, price: parseFloat(price), dueDate });
  res.json(newClient);
});

app.put('/api/clients/:id', (req, res) => {
  const updated = db.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json(updated);
});

app.delete('/api/clients/:id', (req, res) => {
  const deleted = db.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json({ success: true });
});

// ─── Renovar (avança 1 mês a data de vencimento) ─────────────────────────────
app.post('/api/clients/:id/renew', (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const current = new Date(c.dueDate + 'T12:00:00');
  current.setMonth(current.getMonth() + 1);
  const newDate = current.toISOString().split('T')[0];

  const updated = db.update(c.id, { dueDate: newDate, status: 'active', sentNotifications: [] });
  res.json(updated);
});

// ─── Enviar mensagem de teste ─────────────────────────────────────────────────
app.post('/api/clients/:id/test', async (req, res) => {
  if (!botReady) return res.status(503).json({ error: 'WhatsApp não está conectado.' });

  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });

  try {
    const phone = `${c.phone}@c.us`;
    await client.sendMessage(phone, `Olá, *${c.name}*! 👋\nEste é um teste do sistema de cobranças. Tudo funcionando! ✅`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao enviar teste:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Receita mensal ───────────────────────────────────────────────────────────
app.get('/api/revenue', (req, res) => {
  const clients = db.getAll().filter(c => c.status === 'active');
  const total = clients.reduce((sum, c) => sum + (c.price || 0), 0);

  const byPlan = {};
  clients.forEach(c => {
    byPlan[c.plan] = (byPlan[c.plan] || 0) + (c.price || 0);
  });

  res.json({ total, byPlan, activeCount: clients.length, totalCount: db.getAll().length });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐 Dashboard rodando em http://localhost:${PORT}`);
});

console.log('🤖 Iniciando WhatsApp...');
client.initialize();
