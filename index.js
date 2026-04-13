const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

const db = require('./src/database');
const scheduler = require('./src/scheduler');
const backup    = require('./src/backup');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const AUTH_PATH = process.env.AUTH_DATA_PATH || '/app/data/.wwebjs_auth';
const DATA_DIR = '/app/data';

app.use(express.json());

// ─── Importação automática de dados ──────────────────────────────────────────
// Se existir data/clients.json no código E não existir ainda no volume, copia.
function importDataIfNeeded() {
  try {
    // Lê de /app/seeddata — pasta fora do volume que não é sobrescrita na montagem
    const srcClients = '/app/seeddata/clients.json';
    const srcServers = '/app/seeddata/servers.json';
    const dstClients = path.join(DATA_DIR, 'clients.json');
    const dstServers = path.join(DATA_DIR, 'servers.json');

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(srcClients) && (!fs.existsSync(dstClients) || process.env.FORCE_IMPORT === 'true')) {
      fs.copyFileSync(srcClients, dstClients);
      console.log('✅ clients.json importado para o volume!');
    }
    if (fs.existsSync(srcServers) && (!fs.existsSync(dstServers) || process.env.FORCE_IMPORT === 'true')) {
      fs.copyFileSync(srcServers, dstServers);
      console.log('✅ servers.json importado para o volume!');
    }
  } catch(e) {
    console.error('⚠️  Erro na importação de dados:', e.message);
  }
}

importDataIfNeeded();

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
  deleteLocks(DATA_DIR); deleteLocks('/tmp');
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
const puppeteerOptions = {
  executablePath,
  args: puppeteerArgs,
  headless: true,
  protocolTimeout: 120000  // 2 minutos de timeout
};

const clients = {
  personal: { instance: null, qr: null, ready: false, label: 'Particular' },
  work:     { instance: null, qr: null, ready: false, label: 'Trabalho'   }
};

function createClient(key) {
  const c = new Client({
    authStrategy: new LocalAuth({ clientId: key, dataPath: AUTH_PATH }),
    puppeteer: puppeteerOptions,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
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

if (process.env.DISABLE_WHATSAPP !== 'true') {
  cleanupChromium();
  const singleMode = process.env.SINGLE_MODE || 'work';
  if (singleMode === 'work' || singleMode === 'both') {
    console.log('🤖 Iniciando WhatsApp Trabalho...');
    createClient('work').initialize();
  }
  if (singleMode === 'personal') {
    console.log('🤖 Iniciando WhatsApp Particular...');
    createClient('personal').initialize();
  }
  if (singleMode === 'both') {
    setTimeout(() => {
      console.log('🤖 Iniciando WhatsApp Particular...');
      createClient('personal').initialize();
    }, 30000);
  }
} else {
  console.log('⚠️  WhatsApp desativado (DISABLE_WHATSAPP=true). Só o dashboard está rodando.');
}

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
  const newClient = db.add({ name, phone: phone.replace(/\D/g,''), plan, price: parseFloat(price), dueDate, sender, serverId, credits: parseInt(credits)||1 });
  db.addLog('cadastro', name, 'Plano ' + plan + ' | R$ ' + price);
  res.json(newClient);
});

app.put('/api/clients/:id', (req, res) => {
  const u = db.update(req.params.id, req.body);
  if (!u) return res.status(404).json({ error: 'Não encontrado.' });
  if (req.body.status) {
    const action = req.body.status === 'active' ? 'ativacao' : 'pausa';
    const detail = req.body.status === 'active' ? 'Cliente ativado' : 'Cliente pausado';
    db.addLog(action, u.name, detail);
  }
  res.json(u);
});

app.delete('/api/clients/:id', (req, res) => {
  const toDelete = db.getById(req.params.id);
  if (!db.remove(req.params.id)) return res.status(404).json({ error: 'Não encontrado.' });
  if (toDelete) db.addLog('exclusao', toDelete.name, 'Cliente removido');
  res.json({ success: true });
});

app.post('/api/clients/:id/renew', (req, res) => {
  const c = db.getById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Não encontrado.' });
  const todayStr = new Date().toISOString().split('T')[0];
  const baseDate = c.dueDate < todayStr ? new Date(todayStr) : new Date(c.dueDate + 'T12:00:00');
  baseDate.setMonth(baseDate.getMonth() + 1);
  const newDate = baseDate.toISOString().split('T')[0];
  const updated = db.update(c.id, { dueDate: newDate, status:'active', sentNotifications:[] });
  db.addLog('renovacao', c.name, 'Renovado para ' + newDate.split('-').reverse().join('/'));
  res.json(updated);
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
  const today = new Date().toISOString().split('T')[0];
  const all = db.getAll();
  // Ativos = status active E data futura ou hoje
  const active = all.filter(c => c.status === 'active' && c.dueDate >= today);
  const servers = db.getServers();
  const revenue = active.reduce((s, c) => s + (c.price || 0), 0);
  const totalCost = active.reduce((s, c) => {
    const sv = servers.find(x => x.id === c.serverId);
    return s + (sv ? sv.costPerCredit * (c.credits || 1) : 0);
  }, 0);
  res.json({ revenue, totalCost, profit: revenue - totalCost, activeCount: active.length, totalCount: all.length });
});


// ─── Logs ────────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => res.json(db.getLogs()));

// ─── Backup Manual ───────────────────────────────────────────────────────────
app.post('/api/backup', async (req, res) => {
  const result = await backup.sendBackup(true);
  if (result.success) res.json({ success: true, message: 'Backup enviado para ' + process.env.EMAIL_TO });
  else res.status(500).json({ error: result.error || 'Erro ao enviar backup' });
});

// ─── Disparo de Recuperação ───────────────────────────────────────────────────
app.post('/api/blast', async (req, res) => {
  const { clientIds, message, imageBase64, imageMime } = req.body;
  if (!clientIds || !clientIds.length || !message)
    return res.status(400).json({ error: 'Selecione clientes e escreva uma mensagem.' });

  const results = { sent: [], failed: [] };

  for (const id of clientIds) {
    const c = db.getById(id);
    if (!c || !c.phone) {
      results.failed.push({ name: c ? c.name : id, reason: 'Sem WhatsApp' });
      continue;
    }
    const key = c.sender || 'work';
    if (!clients[key] || !clients[key].ready) {
      results.failed.push({ name: c.name, reason: 'WhatsApp não conectado' });
      continue;
    }
    const phone = c.phone + '@c.us';
    const msg = message.replace(/\[nome\]/gi, c.name);
    try {
      if (imageBase64) {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia(imageMime || 'image/jpeg', imageBase64, 'banner.jpg');
        await clients[key].instance.sendMessage(phone, media, { caption: msg });
      } else {
        await clients[key].instance.sendMessage(phone, msg);
      }
      results.sent.push({ name: c.name });
      db.addLog('recuperacao', c.name, 'Mensagem de recuperação enviada');
      await new Promise(r => setTimeout(r, 2000));
    } catch(err) {
      results.failed.push({ name: c.name, reason: err.message });
    }
  }
  res.json(results);
});

// ─── Start ────────────────────────────────────────────────────────────────────
backup.startBackupScheduler();

app.listen(PORT, () => console.log(`🌐 Dashboard em http://localhost:${PORT}`));
