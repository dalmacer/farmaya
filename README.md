# FarmaYa — Deploy con Docker

Backend (Node.js + Express + Bot de Telegram) y frontend estático (cliente,
panel de farmacia multi-tenant, panel admin) corriendo en Docker Compose,
con dominio propio y HTTPS.

## Estado actual

- ✅ Backend y frontend corriendo en Docker en el VPS de Hostinger (`2.25.206.209`)
- ✅ Dominio propio con HTTPS: **https://farma-ya.com.ar** (DNS gestionado en Cloudflare, plan gratuito, modo SSL "Flexible")
- ✅ Flujo completo probado: cliente busca medicamento → farmacia recibe aviso (Telegram + panel web) → farmacia confirma stock → cliente ve el resultado con botón de WhatsApp
- ✅ Soporte multi-farmacia: cada farmacia tiene su propio link (`panel-farmacia.html?id=su_id`)
- ✅ GPS real funcionando (antes bloqueado por no tener HTTPS)
- ⏳ Pendiente: persistencia real con Supabase (hoy todo vive en memoria, se pierde al reiniciar el backend)
- ⏳ Pendiente: formulario web de auto-registro para farmacias (hoy es manual, vía comando de Telegram)

## Estructura del paquete

```
farmaya/
├── server.js              ← backend (Express + Telegram bot)
├── package.json            ← dependencias del backend
├── Dockerfile               ← imagen del backend
├── docker-compose.yml       ← orquesta backend + frontend
├── nginx.conf                ← nginx: sirve el frontend y hace de proxy de la API
├── .env.example                ← plantilla de variables de entorno
├── .dockerignore
├── admin.html               ← panel admin (conectado a /admin/*)
├── cliente.html             ← app de cliente (consulta medicamentos)
├── panel-farmacia.html       ← panel de farmacia, multi-tenant vía ?id=
└── index.html                ← redirige a cliente.html
```

## 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Editá `.env` y completá `TELEGRAM_TOKEN` con el token que te dio @BotFather
en Telegram (`/mybots` → tu bot → API Token). El `PORT` dejalo en `3000`.

## 2. Levantar los contenedores

```bash
docker compose up -d --build
```

Esto levanta dos servicios:

| Servicio   | Puerto | Qué hace |
|------------|--------|----------|
| `backend`  | 3000   | API Express + bot de Telegram |
| `frontend` | 80     | nginx: sirve los `.html` y hace proxy de la API al backend |

**Antes de levantar por primera vez en un VPS nuevo**, asegurate de que
nada más esté usando los puertos 80/3000 (por ejemplo un nginx del sistema
instalado con `apt`, o un proceso `pm2` viejo):

```bash
sudo systemctl stop nginx && sudo systemctl disable nginx   # si hay nginx del sistema
pm2 stop all && pm2 delete all                              # si hay procesos pm2 viejos
```

## 3. Verificar que arrancó bien

```bash
docker compose logs -f backend
```

Deberías ver el bloque de consola con la lista de endpoints y confirmación
de que el bot de Telegram está activo. `Ctrl+C` para salir de los logs (no
corta el contenedor).

## 4. Dominio y HTTPS

El dominio `farma-ya.com.ar` está delegado a los nameservers de Cloudflare
(`julio.ns.cloudflare.com` y `wren.ns.cloudflare.com`, configurados en
NIC.ar vía "Agregar una nueva delegación"). En Cloudflare:

- Registros DNS tipo A: `@` y `www` → `2.25.206.209`, con proxy activado (nube naranja)
- SSL/TLS → modo **Flexible** (Cloudflare da HTTPS al visitante, habla HTTP con el VPS)

`nginx.conf` hace de intermediario entre el dominio y el backend: sirve los
archivos estáticos y redirige las rutas de la API (`/query`, `/responses`,
`/respond`, `/farmacia/*`, `/admin/*`) al contenedor del backend. Esto evita
el problema de "mixed content" (una página HTTPS no puede llamar a un
backend HTTP directo) — todos los archivos HTML usan
`const BACKEND_URL = '';` (ruta relativa, mismo origen).

## 5. Registrar una farmacia

Cada farmacia se registra mandándole un mensaje al bot de Telegram de
FarmaYa (no a BotFather):

```
/start id_unico|Nombre de la Farmacia|latitud|longitud|whatsapp|horario|dirección
```

Ejemplo:
```
/start farmacia_centro|Farmacia Central|-34.8201|-58.3912|5491122334455|8:00-22:00|Av. Hipólito Yrigoyen 123
```

El bot confirma el registro y devuelve el link personalizado de esa
farmacia:
```
https://farma-ya.com.ar/panel-farmacia.html?id=farmacia_centro
```

**Importante:** las farmacias viven en memoria (`Map` en `server.js`), no
en una base de datos. Si el contenedor del backend se reinicia, hay que
volver a registrarlas todas. Esto se resuelve migrando a Supabase
(pendiente, ver más abajo).

## Comandos útiles del día a día

```bash
cd farmaya                          # entrar a la carpeta del proyecto

git pull                            # traer cambios nuevos de GitHub
docker compose up -d --build        # aplicar cambios (reconstruye y reinicia)

docker compose logs -f backend      # ver logs en vivo (Ctrl+C para salir)
docker compose restart frontend     # si el sitio muestra una versión vieja/cacheada

curl http://localhost:3000/admin/farmacias   # ver farmacias registradas ahora
curl http://localhost:3000/admin/consultas   # ver consultas recientes

docker compose down                 # detener todo
```

Si `git pull` falla con "local changes would be overwritten": el archivo
en el servidor tiene cambios manuales que chocan con GitHub. Para
descartarlos y quedarte con la versión de GitHub:
```bash
git checkout -- nombre_del_archivo
git pull
```

## Rutas del backend

```
POST   /query                  ← cliente consulta medicamento
GET    /responses?session=     ← cliente hace polling
POST   /respond                ← farmacia responde (panel web)
GET    /farmacia/:id           ← panel farmacia obtiene sus propios datos (nombre, whatsapp, ubicación)
GET    /farmacia/:id/queries   ← panel farmacia ve sus consultas activas
GET    /admin/consultas        ← panel admin ve todas las consultas
GET    /admin/farmacias        ← panel admin ve todas las farmacias
PATCH  /admin/farmacias/:id    ← panel admin activa/desactiva farmacia
DELETE /admin/farmacias/:id    ← panel admin elimina farmacia
DELETE /admin/consultas        ← panel admin borra consultas (body: {ids:[]})
```

## Pendientes

1. **Migrar a Supabase (PostgreSQL)** — persistencia real para farmacias y consultas, para que no se pierdan al reiniciar el contenedor. Es lo más importante.
2. **Formulario web de auto-registro** de farmacias (nombre, dirección con mapa, WhatsApp, horario) en vez de depender de un comando de Telegram con formato exacto.
3. **Zona horaria del backend** — las horas se muestran en UTC en vez de horario de Argentina (cosmético, no afecta funcionamiento).

## Notas y errores ya resueltos (por si vuelven a aparecer)

- **Dominios `.com.ar` no son compatibles con el "Administrador de DNS" de Hostinger** (no soporta ese TLD) — por eso el DNS se gestiona en Cloudflare.
- **NIC.ar puede tardar horas en propagar** un cambio de delegación de nameservers — no es un error de configuración si tarda.
- **Mensajes de Telegram que no llegan sin error visible**: revisar `docker compose logs -f backend` — suele ser un `ETELEGRAM 400: can't parse entities`, causado por `parse_mode: 'Markdown'` con un guion bajo (`_`) sin cerrar en el texto (por ejemplo, un ID de farmacia o un nombre de medicamento con `_`). Sacar `parse_mode` resuelve el problema.
- **El sitio muestra una versión vieja de un archivo después de actualizarlo**: probar `docker compose restart frontend` antes de asumir que el código está mal.
