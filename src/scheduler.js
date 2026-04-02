const cron = require('node-cron');
const db = require('./database');
const messages = require('./messages');

let cronStarted = false;
let clientsRef = {};

function getDaysUntilDue(dueDateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T12:00:00'); due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

function notifKey(daysLeft) {
  const map = { 7: '7d', 3: '3d', 1: '1d', 0: '0d', '-1': '-1d', '-2': '-2d', '-3': '-3d' };
  return map[String(daysLeft)] || null;
}

async function sendReminder(whatsappClient, clientData, daysLeft) {
  const phone = `${clientData.phone}@c.us`;
  let text;
  if (daysLeft === 7)  text = messages.days7(clientData);
  if (daysLeft === 3)  text = messages.days3(clientData);
  if (daysLeft === 1)  text = messages.days1(clientData);
  if (daysLeft === 0)  text = messages.today(clientData);
  if (daysLeft < 0)   text = messages.overdue(clientData, Math.abs(daysLeft));
  if (!text) return;

  try {
    await whatsappClient.sendMessage(phone, text);
    console.log(`✅ Enviado para ${clientData.name} via [${clientData.sender || 'personal'}] (${daysLeft >= 0 ? daysLeft + 'd' : 'vencido ' + Math.abs(daysLeft) + 'd'})`);

    const sent = Array.isArray(clientData.sentNotifications) ? [...clientData.sentNotifications] : [];
    const key = notifKey(daysLeft);
    if (key && !sent.includes(key)) sent.push(key);
    db.update(clientData.id, { sentNotifications: sent, lastNotificationAt: new Date().toISOString() });
  } catch (err) {
    console.error(`❌ Erro ao enviar para ${clientData.name}:`, err.message);
  }
}

async function runCheck() {
  console.log(`\n⏰ [${new Date().toLocaleString('pt-BR')}] Verificando vencimentos...`);
  const allClients = db.getAll();
  let sent = 0;

  for (const c of allClients) {
    if (c.status === 'inactive') continue;

    const daysLeft = getDaysUntilDue(c.dueDate);
    const key = notifKey(daysLeft);
    if (!key) continue;

    const alreadySent = Array.isArray(c.sentNotifications) && c.sentNotifications.includes(key);
    if (alreadySent) continue;

    // Escolhe o cliente WhatsApp correto
    const senderKey = c.sender || 'personal';
    const waClient = clientsRef[senderKey];

    if (!waClient || !waClient.ready) {
      console.warn(`⚠️  WhatsApp [${senderKey}] não disponível para ${c.name}. Pulando.`);
      continue;
    }

    await sendReminder(waClient.instance, c, daysLeft);
    sent++;

    if (sent < allClients.length) await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`✅ Verificação concluída. ${sent} mensagem(ns) enviada(s).\n`);
}

// Chamado sempre que um dos clientes ficar pronto
function startPartial(clients) {
  clientsRef = clients;
  if (cronStarted) return; // Cron já está rodando
  cronStarted = true;

  const cronExpression = process.env.CRON_TIME || '0 8 * * *';
  cron.schedule(cronExpression, runCheck, { timezone: 'America/Sao_Paulo' });
  console.log(`⏰ Agendador iniciado (${cronExpression} - Brasília)`);
}

module.exports = { startPartial, getDaysUntilDue };
