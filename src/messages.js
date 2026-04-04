function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function formatPrice(price) {
  return Number(price).toFixed(2).replace('.', ',');
}

const footer = `\n\n─────────────────────────\n🤖 *Mensagem automática* — enviada pelo sistema de cobranças.\nCaso já tenha efetuado o pagamento, por favor desconsidere este aviso.\nDúvidas? Responda esta mensagem. 😊`;

const messages = {
  days7: (c) =>
    `Olá, *${c.name}*! 👋\n\n` +
    `⏳ Sua *Lista de TV* vence em *7 dias* (${formatDate(c.dueDate)}).\n\n` +
    `📦 Plano: ${c.plan}\n` +
    `💰 Valor: R$ ${formatPrice(c.price)}\n\n` +
    `Para renovar é só responder essa mensagem! 😊` +
    footer,

  days3: (c) =>
    `Olá, *${c.name}*! ⚠️\n\n` +
    `Faltam apenas *3 dias* para vencer sua *Lista de TV* (${formatDate(c.dueDate)}).\n\n` +
    `📦 Plano: ${c.plan}\n` +
    `💰 Valor: R$ ${formatPrice(c.price)}\n\n` +
    `Não fique sem acesso! Entre em contato para renovar. 🔄` +
    footer,

  days1: (c) =>
    `Olá, *${c.name}*! 🔔\n\n` +
    `⚠️ Sua *Lista de TV* vence *AMANHÃ* (${formatDate(c.dueDate)}).\n\n` +
    `📦 Plano: ${c.plan}\n` +
    `💰 Valor: R$ ${formatPrice(c.price)}\n\n` +
    `Renove hoje para não perder o acesso! 📺` +
    footer,

  today: (c) =>
    `Olá, *${c.name}*! 📅\n\n` +
    `🚨 *Hoje é o último dia* da sua Lista de TV!\n\n` +
    `📦 Plano: ${c.plan}\n` +
    `💰 Valor: R$ ${formatPrice(c.price)}\n\n` +
    `Renove agora para continuar assistindo sem interrupção! 📺✨` +
    footer,

  overdue: (c, daysLate) =>
    `Olá, *${c.name}*! ❌\n\n` +
    `Sua *Lista de TV* venceu há *${daysLate} dia${daysLate > 1 ? 's' : ''}* (${formatDate(c.dueDate)}).\n\n` +
    `📦 Plano: ${c.plan}\n` +
    `💰 Valor: R$ ${formatPrice(c.price)}\n\n` +
    `Entre em contato para reativar o seu acesso. 😊` +
    footer
};

module.exports = messages;
