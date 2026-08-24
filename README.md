# FarmaYa — Deploy con Docker

Este paquete contiene el backend (Node.js + Express + Bot de Telegram) y el
frontend estático (cliente, panel de farmacia, panel admin) listos para
levantar con Docker Compose en un VPS.

## ⚠️ Antes de arrancar

- **HTTPS no está resuelto acá.** Este `docker-compose.yml` sirve el
  frontend por HTTP puro (puerto 80). Si vas a acceder desde un dominio
  con HTTPS (o si el frontend queda en Netlify y llama a este backend),
  vas a tener el mismo problema de *mixed content* que veníamos
  arrastrando. Para resolverlo con este mismo stack, agregá un servicio
  de `nginx` + `certbot` delante, o usá un proxy como Caddy/Traefik que
  maneje el certificado automáticamente.
- **Las sesiones y farmacias viven en memoria** (`Map` en `server.js`).
  Si reiniciás el contenedor `backend`, se pierden. La integración con
  Supabase PostgreSQL para persistencia todavía está pendiente.

## Estructura del paquete

```
farmaya/
├── server.js              ← backend (Express + Telegram bot)
├── package.json            ← dependencias del backend
├── Dockerfile               ← imagen del backend
├── docker-compose.yml       ← orquesta backend + frontend
├── .env.example              ← plantilla de variables de entorno
├── .dockerignore
├── admin.html               ← panel admin (conectado a /admin/*)
├── cliente.html             ← app de cliente (consulta medicamentos)
├── panel-farmacia.html       ← panel de la farmacia (responde consultas)
└── index.html                ← redirige a cliente.html
```

## 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Editá `.env` y completá `TELEGRAM_TOKEN` con el token que te dio
@BotFather en Telegram. El `PORT` podés dejarlo en `3000`.

## 2. Levantar los contenedores

```bash
docker compose up -d --build
```

Esto levanta dos servicios:

| Servicio   | Puerto | Qué hace |
|------------|--------|----------|
| `backend`  | 3000   | API Express + bot de Telegram |
| `frontend` | 80     | Sirve los `.html` estáticos con nginx |

## 3. Verificar que arrancó bien

```bash
docker compose logs -f backend
```

Deberías ver el bloque de consola con la lista de endpoints
(`/query`, `/respond`, `/admin/consultas`, etc.) y confirmación de que
el bot de Telegram está activo.

## 4. Apuntar el frontend al backend correcto

Los tres archivos HTML (`admin.html`, `cliente.html`,
`panel-farmacia.html`) tienen esta línea:

```js
const BACKEND_URL = 'http://2.25.206.209:3000';
```

Si el VPS donde corre este Docker tiene otra IP o dominio, actualizá
esa constante en los tres archivos antes de reconstruir la imagen del
frontend (o antes de copiarlos, si editás directo en el volumen).

## 5. Registrar una farmacia de prueba

Desde Telegram, mandale al bot:

```
/start farmacia_prueba|Farmacia Prueba|-38.09345|-57.55958|5491168568950|8:00-22:00|Santa Maria de Oro 4519
```

Esto la guarda en memoria en el backend, lista para recibir consultas.

## Comandos útiles

```bash
docker compose down              # detener todo
docker compose restart backend    # reiniciar solo el backend
docker compose up -d --build backend   # reconstruir solo el backend tras un cambio en server.js
docker compose logs -f            # ver logs de ambos servicios
```

## Rutas del backend

```
POST   /query                  ← cliente consulta medicamento
GET    /responses?session=     ← cliente hace polling
POST   /respond                ← farmacia responde (panel web)
GET    /farmacia/:id/queries   ← panel farmacia ve consultas
GET    /admin/consultas        ← panel admin ve todas las consultas
GET    /admin/farmacias        ← panel admin ve todas las farmacias
PATCH  /admin/farmacias/:id    ← panel admin activa/desactiva farmacia
DELETE /admin/farmacias/:id    ← panel admin elimina farmacia
DELETE /admin/consultas        ← panel admin borra consultas (body: {ids:[]})
```
