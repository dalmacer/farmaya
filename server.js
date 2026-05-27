/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║         FarmaYa — Backend Server (Node.js + Express)     ║
 * ║  Conecta: App cliente ↔ Backend ↔ Telegram Bot ↔ Farmacia ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * INSTALACIÓN:
 *   npm install express cors node-telegram-bot-api
 *
 * VARIABLES DE ENTORNO (.env):
 *   TELEGRAM_TOKEN=7xxxxxxxxx:AAxxxxxxxxxxxxxxx   ← BotFather
 *   PORT=3000
 *
 * ARRANCAR:
 *   node server.js
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ─── BASE DE DATOS EN MEMORIA (reemplazar por DB real en producción) ──────────
// En producción usar PostgreSQL, MongoDB, Redis, etc.
const sessions   = new Map();   // sessionId → { medicamento, lat, lng, expira, responses[] }
const farmacias  = new Map();   // farmaciaId → { nombre, chatId, lat, lng, whatsapp, horario, direccion }

// ─── REGISTRO DE FARMACIAS ────────────────────────────────────────────────────
// Cada farmacia se registra una sola vez con /start en el bot de Telegram.
// El chatId de Telegram queda guardado y el backend le manda mensajes cuando
// hay una consulta cercana.
//
// Formato de registro vía Telegram:
//   /start farmacia_id|Nombre Farmacia|-38.005|-57.542|5492235551234|8:00-22:00|Av. Mitre 342
//
bot.onText(/\/start (.+)/, (msg, match) => {
  const parts = match[1].split('|');
  if (parts.length < 7) {
    bot.sendMessage(msg.chat.id,
      '❌ Formato incorrecto.\nUsá: /start farmaciaId|Nombre|lat|lng|whatsapp|horario|dirección');
    return;
  }
  const [id, nombre, lat, lng, whatsapp, horario, direccion] = parts;
  farmacias.set(id, {
    id, nombre,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    whatsapp, horario, direccion,
    chatId: msg.chat.id,
    activa: true
  });
  bot.sendMessage(msg.chat.id,
    `✅ *${nombre}* registrada correctamente.\n\n` +
    `📍 Ubicación: ${lat}, ${lng}\n` +
    `📱 WhatsApp: ${whatsapp}\n` +
    `🕐 Horario: ${horario}\n\n` +
    `Cuando un cliente busque un medicamento cercano, te llegará un mensaje acá.\n` +
    `Respondé con:\n  ✅ /tengo_[sessionId]\n  ❌ /notengo_[sessionId]`,
    { parse_mode: 'Markdown' }
  );
});

// ─── RESPUESTA POR TELEGRAM ────────────────────────────────────────────────────
bot.onText(/\/tengo_(\w+)/, (msg, match) => {
  const sessionId = match[1];
  const farmacia  = getFarmaciaByChat(msg.chat.id);
  if (!farmacia) { bot.sendMessage(msg.chat.id, '❌ Farmacia no registrada.'); return; }
  registrarRespuesta(sessionId, farmacia, true);
  bot.sendMessage(msg.chat.id, `✅ Confirmado. El cliente ya puede ver que tienen el medicamento y contactarte por WhatsApp.`);
});

bot.onText(/\/notengo_(\w+)/, (msg, match) => {
  const sessionId = match[1];
  const farmacia  = getFarmaciaByChat(msg.chat.id);
  if (!farmacia) { bot.sendMessage(msg.chat.id, '❌ Farmacia no registrada.'); return; }
  registrarRespuesta(sessionId, farmacia, false);
  bot.sendMessage(msg.chat.id, `👍 Entendido. El cliente no verá tu farmacia para esta consulta.`);
});

function getFarmaciaByChat(chatId) {
  for (const f of farmacias.values()) {
    if (f.chatId === chatId) return f;
  }
  return null;
}

// ─── API: CLIENTE ENVÍA CONSULTA ──────────────────────────────────────────────
app.post('/query', (req, res) => {
  const { session, medicamento, lat, lng, radio_km = 5, expira } = req.body;
  if (!session || !medicamento) return res.status(400).json({ error: 'Faltan campos' });

  const expiraTime = expira ? new Date(expira).getTime() : Date.now() + 10 * 60 * 1000;

  sessions.set(session, {
    medicamento, lat, lng,
    expira: expiraTime,
    responses: [],
    createdAt: Date.now()
  });

  // Buscar farmacias dentro del radio
  const cercanas = getFarmaciasCercanas(lat, lng, radio_km);

  if (cercanas.length === 0) {
    return res.json({ ok: true, farmacias_notificadas: 0 });
  }

  // Notificar por Telegram a cada farmacia cercana
  cercanas.forEach(f => {
    const dist = calcDist(lat, lng, f.lat, f.lng).toFixed(1);
    const expiraMin = Math.round((expiraTime - Date.now()) / 60000);
    bot.sendMessage(f.chatId,
      `🔔 *Nueva consulta de medicamento*\n\n` +
      `💊 *Medicamento:* ${medicamento}\n` +
      `📍 *Distancia:* ${dist} km\n` +
      `⏱ *Tiempo para responder:* ${expiraMin} minutos\n\n` +
      `¿Tenés este medicamento en stock?\n\n` +
      `✅ Si tenés → /tengo_${session}\n` +
      `❌ No tenés → /notengo_${session}`,
      { parse_mode: 'Markdown' }
    ).catch(e => console.error(`Error Telegram farmacia ${f.id}:`, e.message));
  });

  res.json({ ok: true, farmacias_notificadas: cercanas.length });
});

// ─── API: FARMACIA RESPONDE VÍA PANEL WEB ────────────────────────────────────
app.post('/respond', (req, res) => {
  const { session, farmacia_id, tiene_stock } = req.body;
  const farmacia = farmacias.get(farmacia_id) || req.body; // acepta datos inline del panel
  registrarRespuesta(session, farmacia, tiene_stock);
  res.json({ ok: true });
});

function registrarRespuesta(sessionId, farmacia, tieneStock) {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  if (Date.now() > sess.expira) return; // expirada

  // Evitar duplicados
  if (sess.responses.find(r => r.farmacia_id === farmacia.id)) return;

  if (tieneStock) {
    sess.responses.push({
      farmacia_id: farmacia.id,
      nombre:      farmacia.nombre,
      lat:         farmacia.lat,
      lng:         farmacia.lng,
      direccion:   farmacia.direccion,
      horario:     farmacia.horario,
      whatsapp:    farmacia.whatsapp,
      respondedAt: Date.now()
    });
  }
}

// ─── API: CLIENTE HACE POLLING ────────────────────────────────────────────────
app.get('/responses', (req, res) => {
  const { session } = req.query;
  const sess = sessions.get(session);
  if (!sess) return res.json([]);

  const responses = sess.responses.map(r => ({
    ...r,
    hace: timeAgo(r.respondedAt)
  }));

  res.json(responses);
});

// ─── API: PANEL FARMACIA — VER CONSULTAS ACTIVAS ─────────────────────────────
app.get('/farmacia/:id/queries', (req, res) => {
  const farmaciaId = req.params.id;
  const farmacia   = farmacias.get(farmaciaId);
  if (!farmacia) return res.json([]);

  const now = Date.now();
  const activas = [];

  sessions.forEach((sess, sessionId) => {
    if (sess.expira < now) return; // expirada
    // verificar si es cercana
    const dist = calcDist(sess.lat, sess.lng, farmacia.lat, farmacia.lng);
    if (dist > 5) return; // fuera de radio
    // verificar si ya respondió
    const yaRespondio = sess.responses.find(r => r.farmacia_id === farmaciaId);

    activas.push({
      id: sessionId,
      session: sessionId,
      medicamento: sess.medicamento,
      distancia: dist.toFixed(1) + ' km',
      expira: new Date(sess.expira).toISOString(),
      hace: timeAgo(sess.createdAt),
      respondida: !!yaRespondio
    });
  });

  res.json(activas);
});

// ─── LIMPIEZA AUTOMÁTICA DE SESIONES EXPIRADAS ───────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions.entries()) {
    if (now > sess.expira + 60 * 60 * 1000) { // 1h después de expirar
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─── UTILS ───────────────────────────────────────────────────────────────────
function getFarmaciasCercanas(lat, lng, radioKm) {
  return Array.from(farmacias.values()).filter(f => {
    return f.activa && calcDist(lat, lng, f.lat, f.lng) <= radioKm;
  });
}

function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'hace < 1 min';
  if (diff < 3600) return `hace ${Math.floor(diff/60)} min`;
  return `hace ${Math.floor(diff/3600)} h`;
}

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════╗
  ║  FarmaYa Backend corriendo en :${PORT}  ║
  ╚════════════════════════════════════╝
  
  Endpoints disponibles:
    POST /query              ← cliente consulta medicamento
    GET  /responses?session= ← cliente hace polling
    POST /respond            ← farmacia responde (panel web)
    GET  /farmacia/:id/queries ← panel farmacia ve consultas
  
  Bot de Telegram activo.
  `);
});

module.exports = app;
