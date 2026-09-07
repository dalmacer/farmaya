/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║         FarmaYa — Backend Server (Node.js + Express)     ║
 * ║  Conecta: App cliente ↔ Backend ↔ Telegram Bot ↔ Farmacia ║
 * ║  Persistencia: Supabase (PostgreSQL)                      ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * INSTALACIÓN:
 *   npm install
 *
 * VARIABLES DE ENTORNO (.env):
 *   TELEGRAM_TOKEN=7xxxxxxxxx:AAxxxxxxxxxxxxxxx   ← BotFather
 *   PORT=3000
 *   SUPABASE_URL=https://xxxxxxxx.supabase.co
 *   SUPABASE_KEY=xxxxxxxx  (service_role / secret key)
 *
 * ARRANCAR:
 *   node server.js
 */

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ─── REGISTRO DE FARMACIAS POR TELEGRAM ───────────────────────────────────────
// Cada farmacia se registra una sola vez con /start en el bot de Telegram.
// El chatId de Telegram queda guardado y el backend le manda mensajes cuando
// hay una consulta cercana. Estas quedan activas automáticamente.
//
// Formato de registro vía Telegram:
//   /start farmacia_id|Nombre Farmacia|-38.005|-57.542|5492235551234|8:00-22:00|Av. Mitre 342
//
bot.onText(/\/start (.+)/, async (msg, match) => {
  const parts = match[1].split('|');
  if (parts.length < 7) {
    bot.sendMessage(msg.chat.id,
      '❌ Formato incorrecto.\nUsá: /start farmaciaId|Nombre|lat|lng|whatsapp|horario|dirección');
    return;
  }
  const [id, nombre, lat, lng, whatsapp, horario, direccion] = parts;

  const { error } = await supabase.from('farmacias').upsert({
    id,
    nombre,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    whatsapp, horario, direccion,
    chat_id: msg.chat.id,
    activa: true
  });

  if (error) {
    console.error('Error registrando farmacia:', error.message);
    bot.sendMessage(msg.chat.id, '❌ Hubo un error guardando el registro. Intentá de nuevo.');
    return;
  }

  bot.sendMessage(msg.chat.id,
    `✅ ${nombre} registrada correctamente.\n\n` +
    `📍 Ubicación: ${lat}, ${lng}\n` +
    `📱 WhatsApp: ${whatsapp}\n` +
    `🕐 Horario: ${horario}\n\n` +
    `Panel web: https://farma-ya.com.ar/panel-farmacia.html?id=${id}\n\n` +
    `Cuando un cliente busque un medicamento cercano, te llegará un mensaje acá.\n` +
    `Respondé con:\n  ✅ /tengo_[sessionId]\n  ❌ /notengo_[sessionId]`
  );
});

// ─── RESPUESTA POR TELEGRAM ────────────────────────────────────────────────────
bot.onText(/\/tengo_(\w+)/, async (msg, match) => {
  const sessionId = match[1];
  const farmacia  = await getFarmaciaByChat(msg.chat.id);
  if (!farmacia) { bot.sendMessage(msg.chat.id, '❌ Farmacia no registrada.'); return; }
  await registrarRespuesta(sessionId, farmacia, true);
  bot.sendMessage(msg.chat.id, `✅ Confirmado. El cliente ya puede ver que tienen el medicamento y contactarte por WhatsApp.`);
});

bot.onText(/\/notengo_(\w+)/, async (msg, match) => {
  const sessionId = match[1];
  const farmacia  = await getFarmaciaByChat(msg.chat.id);
  if (!farmacia) { bot.sendMessage(msg.chat.id, '❌ Farmacia no registrada.'); return; }
  await registrarRespuesta(sessionId, farmacia, false);
  bot.sendMessage(msg.chat.id, `👍 Entendido. El cliente no verá tu farmacia para esta consulta.`);
});

async function getFarmaciaByChat(chatId) {
  const { data } = await supabase.from('farmacias').select('*').eq('chat_id', chatId).maybeSingle();
  return data || null;
}

// ─── API: FARMACIA SE AUTO-REGISTRA POR FORMULARIO WEB ───────────────────────
// Queda inactiva (pendiente) hasta que el admin la apruebe desde admin.html.
app.post('/registro', async (req, res) => {
  const { nombre, direccion, whatsapp, horario, lat, lng } = req.body;
  if (!nombre || !whatsapp || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const base = slugify(nombre) || 'farmacia';
  const id = `${base}_${Math.random().toString(36).slice(2, 7)}`;

  const { error } = await supabase.from('farmacias').insert({
    id,
    nombre,
    direccion: direccion || '',
    whatsapp,
    horario: horario || '',
    lat, lng,
    activa: false
  });

  if (error) {
    console.error('Error en auto-registro:', error.message);
    return res.status(500).json({ error: 'No se pudo registrar la farmacia' });
  }

  res.json({ ok: true, id });
});

function slugify(text) {
  return text.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ─── API: CLIENTE ENVÍA CONSULTA ──────────────────────────────────────────────
app.post('/query', async (req, res) => {
  const { session, medicamento, lat, lng, radio_km = 5, expira } = req.body;
  if (!session || !medicamento) return res.status(400).json({ error: 'Faltan campos' });

  const expiraTime = expira ? new Date(expira) : new Date(Date.now() + 10 * 60 * 1000);

  const cercanas = await getFarmaciasCercanas(lat, lng, radio_km);
  const notificadas = cercanas.map(f => f.id);

  const { error } = await supabase.from('sesiones').insert({
    id: session,
    medicamento, lat, lng,
    expira: expiraTime.toISOString(),
    notificadas
  });

  if (error) {
    console.error('Error guardando consulta:', error.message);
    return res.status(500).json({ error: 'No se pudo guardar la consulta' });
  }

  if (cercanas.length === 0) {
    return res.json({ ok: true, farmacias_notificadas: 0 });
  }

  // Notificar por Telegram solo a las farmacias que tienen chat vinculado
  cercanas.forEach(f => {
    if (!f.chat_id) return;
    const dist = calcDist(lat, lng, f.lat, f.lng).toFixed(1);
    const expiraMin = Math.round((expiraTime.getTime() - Date.now()) / 60000);
    bot.sendMessage(f.chat_id,
      `🔔 Nueva consulta de medicamento\n\n` +
      `💊 Medicamento: ${medicamento}\n` +
      `📍 Distancia: ${dist} km\n` +
      `⏱ Tiempo para responder: ${expiraMin} minutos\n\n` +
      `¿Tenés este medicamento en stock?\n\n` +
      `✅ Si tenés → /tengo_${session}\n` +
      `❌ No tenés → /notengo_${session}`
    ).catch(e => console.error(`Error Telegram farmacia ${f.id}:`, e.message));
  });

  res.json({ ok: true, farmacias_notificadas: cercanas.length });
});

// ─── API: FARMACIA RESPONDE VÍA PANEL WEB ────────────────────────────────────
app.post('/respond', async (req, res) => {
  const { session, farmacia_id, tiene_stock } = req.body;

  const { data: farmaciaDb } = await supabase.from('farmacias').select('*').eq('id', farmacia_id).maybeSingle();
  const farmacia = farmaciaDb || req.body;

  await registrarRespuesta(session, farmacia, tiene_stock);
  res.json({ ok: true });
});

async function registrarRespuesta(sessionId, farmacia, tieneStock) {
  const { data: sess } = await supabase.from('sesiones').select('expira').eq('id', sessionId).maybeSingle();
  if (!sess) return;
  if (new Date(sess.expira).getTime() < Date.now()) return; // expirada

  const { error } = await supabase.from('respuestas').insert({
    session_id: sessionId,
    farmacia_id: farmacia.id,
    tiene_stock: tieneStock
  });

  // Código 23505 = ya existía una respuesta de esta farmacia para esta sesión (evitar duplicados)
  if (error && error.code !== '23505') {
    console.error('Error registrando respuesta:', error.message);
  }
}

// ─── API: CLIENTE HACE POLLING ────────────────────────────────────────────────
app.get('/responses', async (req, res) => {
  const { session } = req.query;

  const { data, error } = await supabase
    .from('respuestas')
    .select('farmacia_id, responded_at, farmacias ( nombre, lat, lng, direccion, horario, whatsapp )')
    .eq('session_id', session)
    .eq('tiene_stock', true)
    .order('responded_at', { ascending: true });

  if (error || !data) return res.json([]);

  const responses = data
    .filter(r => r.farmacias)
    .map(r => ({
      farmacia_id: r.farmacia_id,
      nombre: r.farmacias.nombre,
      lat: r.farmacias.lat,
      lng: r.farmacias.lng,
      direccion: r.farmacias.direccion,
      horario: r.farmacias.horario,
      whatsapp: r.farmacias.whatsapp,
      hace: timeAgo(new Date(r.responded_at).getTime())
    }));

  res.json(responses);
});

// ─── API: PANEL FARMACIA — DATOS PROPIOS DE LA FARMACIA ──────────────────────
app.get('/farmacia/:id', async (req, res) => {
  const { data, error } = await supabase.from('farmacias').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Farmacia no encontrada' });
  res.json({
    id: data.id,
    nombre: data.nombre,
    whatsapp: data.whatsapp,
    horario: data.horario,
    direccion: data.direccion,
    lat: data.lat,
    lng: data.lng,
    activa: data.activa
  });
});

// ─── API: PANEL FARMACIA — VER CONSULTAS ACTIVAS ─────────────────────────────
app.get('/farmacia/:id/queries', async (req, res) => {
  const farmaciaId = req.params.id;
  const { data: farmacia } = await supabase.from('farmacias').select('*').eq('id', farmaciaId).maybeSingle();
  if (!farmacia) return res.json([]);

  const nowIso = new Date().toISOString();
  const { data: sesionesActivas } = await supabase.from('sesiones').select('*').gt('expira', nowIso);
  if (!sesionesActivas) return res.json([]);

  const { data: respondidas } = await supabase
    .from('respuestas')
    .select('session_id')
    .eq('farmacia_id', farmaciaId);
  const respondidasSet = new Set((respondidas || []).map(r => r.session_id));

  const activas = sesionesActivas
    .map(sess => ({ sess, dist: calcDist(sess.lat, sess.lng, farmacia.lat, farmacia.lng) }))
    .filter(({ dist }) => dist <= 5)
    .map(({ sess, dist }) => ({
      id: sess.id,
      session: sess.id,
      medicamento: sess.medicamento,
      distancia: dist.toFixed(1) + ' km',
      expira: sess.expira,
      hace: timeAgo(new Date(sess.created_at).getTime()),
      respondida: respondidasSet.has(sess.id)
    }));

  res.json(activas);
});

// ─── API: ADMIN — CONSULTAS ───────────────────────────────────────────────────
app.get('/admin/consultas', async (req, res) => {
  const { data: sesiones } = await supabase.from('sesiones').select('*').order('created_at', { ascending: false });
  if (!sesiones) return res.json([]);

  const { data: respuestas } = await supabase
    .from('respuestas')
    .select('session_id, tiene_stock, farmacias ( nombre, lat, lng )');

  const porSesion = {};
  (respuestas || []).forEach(r => {
    if (!porSesion[r.session_id]) porSesion[r.session_id] = [];
    porSesion[r.session_id].push(r);
  });

  const filas = sesiones.map(sess => {
    const resp = porSesion[sess.id] || [];
    const conStock  = resp.find(r => r.tiene_stock && r.farmacias);
    const cualquiera = resp.find(r => r.farmacias);

    let estado = 'Sin respuesta', farmaciaNombre = '—', distancia = '—';
    if (conStock) {
      estado = 'Con stock';
      farmaciaNombre = conStock.farmacias.nombre;
      distancia = calcDist(sess.lat, sess.lng, conStock.farmacias.lat, conStock.farmacias.lng).toFixed(1) + ' km';
    } else if (cualquiera) {
      estado = 'Sin stock';
      farmaciaNombre = cualquiera.farmacias.nombre;
    }

    const d = new Date(sess.created_at);
    return {
      id: sess.id,
      medicamento: sess.medicamento,
      farmacia: farmaciaNombre,
      estado,
      distancia,
      fecha: d.toLocaleDateString('es-AR'),
      hora: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    };
  });

  res.json(filas);
});

// ─── API: ADMIN — FARMACIAS ───────────────────────────────────────────────────
app.get('/admin/farmacias', async (req, res) => {
  const { data: farmacias } = await supabase.from('farmacias').select('*').order('created_at', { ascending: false });
  const { data: sesiones }  = await supabase.from('sesiones').select('id, notificadas');
  const { data: respuestas } = await supabase.from('respuestas').select('farmacia_id, tiene_stock');

  const filas = (farmacias || []).map(f => {
    const consultasCount = (sesiones || []).filter(s => (s.notificadas || []).includes(f.id)).length;
    const conStockCount  = (respuestas || []).filter(r => r.farmacia_id === f.id && r.tiene_stock).length;

    return {
      id: f.id,
      nombre: f.nombre,
      direccion: f.direccion,
      whatsapp: f.whatsapp,
      horario: f.horario,
      lat: f.lat,
      lng: f.lng,
      activa: f.activa,
      consultas: consultasCount,
      conStock: conStockCount
    };
  });

  res.json(filas);
});

app.patch('/admin/farmacias/:id', async (req, res) => {
  const { data: actual } = await supabase.from('farmacias').select('activa').eq('id', req.params.id).maybeSingle();
  if (!actual) return res.status(404).json({ error: 'Farmacia no encontrada' });

  const nuevoValor = typeof req.body.activa === 'boolean' ? req.body.activa : !actual.activa;
  const { error } = await supabase.from('farmacias').update({ activa: nuevoValor }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, activa: nuevoValor });
});

app.delete('/admin/farmacias/:id', async (req, res) => {
  const { error } = await supabase.from('farmacias').delete().eq('id', req.params.id);
  res.json({ ok: !error });
});

app.delete('/admin/consultas', async (req, res) => {
  const { ids = [] } = req.body;
  if (ids.length === 0) return res.json({ ok: true, borradas: 0 });
  const { error, count } = await supabase.from('sesiones').delete({ count: 'exact' }).in('id', ids);
  res.json({ ok: !error, borradas: count || 0 });
});

// ─── LIMPIEZA AUTOMÁTICA DE SESIONES EXPIRADAS ───────────────────────────────
setInterval(async () => {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('sesiones').delete().lt('expira', cutoff);
  if (error) console.error('Error en limpieza automática:', error.message);
}, 5 * 60 * 1000);

// ─── UTILS ───────────────────────────────────────────────────────────────────
async function getFarmaciasCercanas(lat, lng, radioKm) {
  const { data, error } = await supabase.from('farmacias').select('*').eq('activa', true);
  if (error || !data) return [];
  return data.filter(f => calcDist(lat, lng, f.lat, f.lng) <= radioKm);
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
  
  Persistencia: Supabase (${process.env.SUPABASE_URL ? 'conectado' : '⚠️ SIN CONFIGURAR'})
  
  Endpoints disponibles:
    POST /query                  ← cliente consulta medicamento
    GET  /responses?session=     ← cliente hace polling
    POST /respond                ← farmacia responde (panel web)
    POST /registro                ← farmacia se auto-registra (queda pendiente)
    GET  /farmacia/:id           ← panel farmacia obtiene sus propios datos
    GET  /farmacia/:id/queries   ← panel farmacia ve consultas
    GET  /admin/consultas        ← panel admin ve todas las consultas
    GET  /admin/farmacias        ← panel admin ve todas las farmacias
    PATCH /admin/farmacias/:id   ← panel admin activa/desactiva farmacia
    DELETE /admin/farmacias/:id  ← panel admin elimina farmacia
    DELETE /admin/consultas      ← panel admin borra consultas (body: {ids:[]})
  
  Bot de Telegram activo.
  `);
});

module.exports = app;
