# 📺 Bot de Cobranças WhatsApp — Lista de TV

Bot automático de cobranças via WhatsApp para serviços de streaming, com painel de controle web.

---

## ✅ Funcionalidades

- Avisos automáticos de vencimento: **7 dias, 3 dias, 1 dia antes, no dia e após vencer**
- Não envia a mesma notificação duas vezes (controla por ciclo de cobrança)
- Painel web para **cadastrar, renovar, pausar e excluir clientes**
- Resumo de **receita mensal** e status de vencimentos
- Botão de **mensagem de teste** para validar o contato

---

## 📁 Estrutura do Projeto

```
whatsapp-bot-cobrancas/
├── index.js              # Servidor principal (WhatsApp + API REST)
├── src/
│   ├── database.js       # Banco de dados em JSON
│   ├── scheduler.js      # Agendamento diário de notificações
│   └── messages.js       # Templates das mensagens
├── public/
│   └── index.html        # Dashboard web
├── Dockerfile            # Deploy no Railway
├── package.json
└── .gitignore
```

---

## 🚀 Deploy no Railway

### 1. Suba o código no GitHub

```bash
git init
git add .
git commit -m "primeiro commit"
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

### 2. Crie o projeto no Railway

1. Acesse [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Selecione o repositório
3. O Railway vai detectar o `Dockerfile` automaticamente

### 3. Configure o Volume (IMPORTANTE — dados persistentes)

Sem o volume, os dados são perdidos ao reiniciar o serviço.

1. No projeto Railway, clique no serviço → aba **Volumes**
2. Clique em **Add Volume**
3. Configure:
   - **Mount Path:** `/app/data`
4. Salve

> O arquivo `clients.json` ficará em `/app/data/` dentro do volume.

### 4. Escaneie o QR Code

1. Acesse o dashboard pelo link gerado pelo Railway (ex: `https://seu-bot.up.railway.app`)
2. Clique no botão de status no canto superior direito
3. Escaneie o QR Code com o WhatsApp do número que vai enviar as cobranças

> ⚠️ O WhatsApp ficará **"Dispositivo vinculado"** no celular. Não precisa ficar com o celular online.

---

## ⚙️ Variáveis de Ambiente (opcionais)

Configure no Railway em **Variables**:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor (Railway injeta automaticamente) |
| `CRON_TIME` | `0 8 * * *` | Horário do envio diário (8h de Brasília) |
| `DATA_DIR` | `./data` | Pasta do banco de dados |
| `AUTH_DATA_PATH` | `.wwebjs_auth` | Pasta de sessão do WhatsApp |

**Exemplo para enviar às 9h:**
```
CRON_TIME=0 9 * * *
```

---

## 📱 Como Usar o Dashboard

### Cadastrar cliente
Preencha o formulário com:
- **Nome** — nome do cliente
- **WhatsApp** — número com DDI + DDD (ex: `5511999998888`)
- **Plano** — nome do plano (ex: Mensal, Família, VIP)
- **Valor R$** — valor cobrado
- **Vencimento** — data do vencimento atual

### Ações disponíveis
- **🔄 Renovar** — Avança o vencimento em 1 mês e reseta as notificações do ciclo
- **📨 Teste** — Envia uma mensagem de teste para o número do cliente
- **⏸ Pausar / ▶ Ativar** — Pausa ou ativa o cliente (pausado não recebe notificações)
- **🗑 Excluir** — Remove o cliente permanentemente

---

## 📩 Mensagens Enviadas

| Quando | Mensagem |
|---|---|
| 7 dias antes | Aviso amigável de vencimento próximo |
| 3 dias antes | Aviso com urgência leve |
| 1 dia antes | Aviso de vencimento amanhã |
| No dia | Último dia de acesso |
| 1, 2, 3 dias após | Notificação de vencido |

---

## ⚠️ Observações Importantes

- **Número do WhatsApp:** Use um número dedicado para o bot. Não use seu número pessoal principal.
- **Intervalos:** O bot aguarda 3 segundos entre cada mensagem para evitar bloqueios.
- **Reconexão:** Se o WhatsApp desconectar, o bot tenta reconectar automaticamente após 10 segundos.
- **Sessão:** A sessão fica salva no container. Se o container for recriado, precisará escanear o QR novamente (por isso configure o Volume).

---

## 🛠️ Desenvolvimento Local

```bash
npm install
node index.js
# Acesse http://localhost:3000
```
