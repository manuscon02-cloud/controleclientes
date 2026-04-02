const cron = require('node-cron');
const db = require('./database');
const messages = require('./messages');

// Retorna quantos dias faltam para o vencimento (negativo = já venceu)
function getDaysUntilDue(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T12:00:00');
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

// Chave que identifica qual notificação foi enviada neste ciclo
function notifKey(daysLeft) {
  if (daysLeft === 7)  return '7d';
  if (daysLeft === 3)  return '3d';
  if (daysLeft === 1)  return '1d';
  if (daysLeft === 0)  return '0d';
  if (daysLeft === -1) return '-1d';
  if (daysLeft === -2) return '-2d';
  if (daysLeft === -3) return '-3d';
  return null;
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
    console.log(`✅ [${new Date().toLocaleTimeString('pt-BR')}] Enviado para ${clientData.name} (${daysLeft >= 0 ? daysLeft + ' dias' : 'vencido há ' + Math.abs(daysLeft) + 'd'})`);

    // Marca que essa notificação já foi enviada neste ciclo
    const sent = Array.isArray(clientData.sentNotifications) ? [...clientData.sentNotifications] : [];
    const key = notifKey(daysLeft);
    if (key && !sent.includes(key)) sent.push(key);
    db.update(clientData.id, { sentNotifications: sent, lastNotificationAt: new Date().toISOString() });

  } catch (err) {
    console.error(`❌ Erro ao enviar para ${clientData.name}:`, err.message);
  }
}

function start(whatsappClient) {
  // Roda todo dia às 8h (horário de Brasília)
  // Para mudar o horário, defina a variável de ambiente CRON_TIME
  // Exemplo: CRON_TIME="0 9 * * *" para 9h
  const cronExpression = process.env.CRON_TIME || '0 8 * * *';

  cron.schedule(cronExpression, async () => {
    console.log(`\n⏰ [${new Date().toLocaleString('pt-BR')}] Verificando vencimentos...`);

    const clients = db.getAll();
    let sent = 0;

    for (const c of clients) {
      // Ignora clientes inativos
      if (c.status === 'inactive') continue;

      const daysLeft = getDaysUntilDue(c.dueDate);
      const key = notifKey(daysLeft);

      // Só notifica em datas específicas: 7, 3, 1, 0, -1, -2, -3
      if (!key) continue;

      // Não envia de novo se já enviou neste ciclo
      const alreadySent = Array.isArray(c.sentNotifications) && c.sentNotifications.includes(key);
      if (alreadySent) continue;

      await sendReminder(whatsappClient, c, daysLeft);
      sent++;

      // Aguarda 3 segundos entre mensagens para não ser bloqueado
      if (sent < clients.length) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    console.log(`✅ Verificação concluída. ${sent} mensagem(ns) enviada(s).\n`);
  }, {
    timezone: 'America/Sao_Paulo'
  });

  console.log(`⏰ Agendador iniciado (${cronExpression} - Brasília)`);
}

module.exports = { start, getDaysUntilDue };
