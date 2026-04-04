FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Move os arquivos de seed para /app/seeddata ANTES do volume montar
# O volume monta em /app/data e sobrescreveria os arquivos se ficassem lá
RUN mkdir -p /app/seeddata && \
    if [ -f /app/data/clients.json ]; then cp /app/data/clients.json /app/seeddata/clients.json; fi && \
    if [ -f /app/data/servers.json ]; then cp /app/data/servers.json /app/seeddata/servers.json; fi

EXPOSE 8080

CMD ["node", "index.js"]
