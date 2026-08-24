# FarmaYa — Backend (Node.js + Express + Bot de Telegram)
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (mejor cacheo de capas)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
