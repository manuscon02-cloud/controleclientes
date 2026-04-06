const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const DATA_DIR = '/app/data';

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

async function sendBackup(manual = false) {
  const emailUser = process.env.EMAIL_USER;
  const emailTo   = process.env.EMAIL_TO;

  if (!emailUser || !emailTo) {
    console.log('⚠️  EMAIL_USER ou EMAIL_TO não configurados. Backup por email desativado.');
    return { success: false, error: 'Email não configurado' };
  }

  try {
    const clientsFile = path.join(DATA_DIR, 'clients.json');
    const serversFile = path.join(DATA_DIR, 'servers.json');

    if (!fs.existsSync(clientsFile)) {
      return { success: false, error: 'Arquivo clients.json não encontrado' };
    }

    const clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
    const servers = fs.existsSync(serversFile) ? JSON.parse(fs.readFileSync(serversFile, 'utf8')) : [];

    const today = new Date().toISOString().split('T')[0];
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const activeClients = clients.filter(c => c.status === 'active' && c.dueDate >= today);
    const overdueClients = clients.filter(c => c.status === 'active' && c.dueDate < today);
    const totalRevenue = activeClients.reduce((s, c) => s + (c.price || 0), 0);

    const transporter = createTransporter();

    const subject = manual
      ? `📦 Backup Manual - Bot de Cobranças (${todayStr})`
      : `📦 Backup Diário - Bot de Cobranças (${todayStr})`;

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#25d366">📺 Bot de Cobranças — Backup ${manual ? 'Manual' : 'Diário'}</h2>
        <p style="color:#636e72">${todayStr}</p>

        <div style="background:#f5f6fa;border-radius:12px;padding:20px;margin:20px 0">
          <h3 style="margin:0 0 12px">📊 Resumo</h3>
          <p>👥 Total de clientes: <strong>${clients.length}</strong></p>
          <p>✅ Ativos: <strong>${activeClients.length}</strong></p>
          <p>⚠️  Vencidos: <strong>${overdueClients.length}</strong></p>
          <p>💰 Receita mensal: <strong>R$ ${totalRevenue.toFixed(2).replace('.', ',')}</strong></p>
          <p>🖥️  Servidores: <strong>${servers.length}</strong></p>
        </div>

        <p style="color:#636e72;font-size:.9rem">
          Os arquivos <strong>clients.json</strong> e <strong>servers.json</strong> estão anexados neste email.<br>
          Em caso de perda de dados, entre em contato para restaurar o backup.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Bot de Cobranças" <${emailUser}>`,
      to: emailTo,
      subject,
      html,
      attachments: [
        { filename: `clients_${today}.json`, content: JSON.stringify(clients, null, 2) },
        { filename: `servers_${today}.json`, content: JSON.stringify(servers, null, 2) }
      ]
    });

    console.log(`✅ Backup enviado para ${emailTo}`);
    return { success: true, clientCount: clients.length };

  } catch (err) {
    console.error('❌ Erro ao enviar backup:', err.message);
    return { success: false, error: err.message };
  }
}

function startBackupScheduler() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_TO) return;
  // Todo dia às 23h
  cron.schedule('0 23 * * *', () => {
    console.log('📦 Iniciando backup diário...');
    sendBackup(false);
  }, { timezone: 'America/Sao_Paulo' });
  console.log('📦 Backup automático agendado para 23h diariamente');
}

module.exports = { sendBackup, startBackupScheduler };
