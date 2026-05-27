# FarmaYa — Sistema completo

## Arquitectura del sistema

```
CLIENTE (GPS + búsqueda)
       │
       │  POST /query  (medicamento + GPS coords)
       ▼
  BACKEND (Node.js)
       │
       ├──── Encuentra farmacias en radio 5 km
       │
       ├──── Envía mensaje Telegram a cada farmacia:
       │     "¿Tenés ibuprofeno? /tengo_ABC123 | /notengo_ABC123"
       │
       │     O muestra la consulta en el Panel Web de la farmacia
       │
       │  Farmacia responde vía Telegram o Panel Web
       │
       ▼
  Backend guarda la respuesta

CLIENTE hace polling cada 5 seg → GET /responses?session=ABC123
       │
       ▼
  Muestra en el mapa las farmacias que confirmaron stock
  Botón WhatsApp directo a cada farmacia
```

---

## Archivos del proyecto

| Archivo | Descripción |
|---------|-------------|
| `cliente.html` | App del cliente con GPS real y mapa OpenStreetMap |
| `panel-farmacia.html` | Panel web para las farmacias |
| `server.js` | Backend Node.js con bot de Telegram |

---

## Instalación del backend

```bash
mkdir farmaya && cd farmaya
npm init -y
npm install express cors node-telegram-bot-api dotenv

# Pegar server.js aquí
# Crear .env:
echo "TELEGRAM_TOKEN=TU_TOKEN_AQUI" > .env
echo "PORT=3000" >> .env

node server.js
```

---

## Crear el bot de Telegram

1. Abrí Telegram y buscá **@BotFather**
2. Enviá `/newbot` y seguí los pasos
3. Copiá el token y pegalo en `.env`

---

## Registro de una farmacia

Cada farmacia, **una sola vez**, abre el bot en Telegram y envía:

```
/start farmacia_del_pueblo|Farmacia Del Pueblo|-38.0055|-57.5426|5492235551234|8:00-22:00|Av. Mitre 342
```

Formato: `/start id|nombre|lat|lng|whatsapp|horario|direccion`

A partir de ese momento reciben consultas automáticamente.

---

## Flujo completo

### 1. Cliente busca un medicamento
- Abre `cliente.html`
- El GPS detecta su ubicación real
- Escribe "ibuprofeno" y presiona Consultar
- El backend notifica a todas las farmacias en 5 km

### 2. Farmacia recibe la consulta
**Opción A — Telegram:**
```
🔔 Nueva consulta de medicamento

💊 Medicamento: Ibuprofeno 400mg
📍 Distancia: 0.8 km
⏱ Tiempo para responder: 10 minutos

✅ Si tenés → /tengo_ABC123
❌ No tenés → /notengo_ABC123
```

**Opción B — Panel web:**
- La farmacia abre `panel-farmacia.html`
- Ve la consulta con el contador regresivo
- Hace clic en ✓ Tengo stock o ✗ Sin stock

### 3. Cliente ve las respuestas en tiempo real
- El mapa se actualiza cada 5 segundos
- Las farmacias que confirmaron stock aparecen como pins verdes
- Cada tarjeta tiene el botón **Contactar por WhatsApp**
- El mensaje pre-escrito ya incluye el medicamento buscado

### 4. Cliente contacta por WhatsApp
Al pulsar el botón se abre WhatsApp con el mensaje:
> "Hola! Vi que tienen Ibuprofeno 400mg disponible. ¿Me pueden confirmar precio y si tienen stock ahora?"

---

## Despliegue recomendado

| Componente | Servicio |
|------------|---------|
| Backend Node.js | Railway, Render, o VPS |
| cliente.html | GitHub Pages, Netlify, o Vercel |
| panel-farmacia.html | Mismo hosting o Netlify |
| Bot Telegram | Corre en el mismo servidor Node.js |

---

## Variables de entorno

```env
TELEGRAM_TOKEN=7xxxxxxxxx:AAxxxxxxxxxxxxxxx
PORT=3000
```

---

## Personalización

- **Radio de búsqueda:** cambiar `radio_km: 5` en `cliente.html`
- **Tiempo de expiración:** cambiar `TIMEOUT_MS = 10 * 60 * 1000` en `cliente.html`
- **Logo/nombre:** cambiar "FarmaYa" en los HTML
- **Idioma del bot:** editar los mensajes en `server.js`
