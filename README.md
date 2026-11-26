# CUR

Aplicación para administrar cursos de Coursera, Udemy y otras fuentes, registrar habilidades y generar o evaluar rutas de aprendizaje con Gemini. Funciona como Cloudflare Worker, guarda los datos en D1 y sirve la interfaz estática desde Cloudflare Assets.

## Requisitos

- Node.js 22.13 o superior para ejecutar las pruebas.
- Una cuenta de Cloudflare.
- Una clave de Gemini API para las funciones de rutas con IA.

## Desarrollo local

Instala Wrangler e inicia sesión:

```sh
npx wrangler login
```

Crea el archivo `.dev.vars`, que está ignorado por Git:

```dotenv
GEMINI_API_KEY=tu_clave_de_gemini
API_TOKEN=un_token_largo_y_aleatorio
# Solo en .dev.vars, puedes usar CUR_ALLOW_UNAUTHENTICATED_LOCAL=true en lugar de API_TOKEN para desarrollo local.
```

Aplica las migraciones a la copia local de D1:

```sh
npx wrangler d1 migrations apply cur --local
npx wrangler dev
```

El formulario de acceso solo guarda `API_TOKEN` en el navegador después de comprobarlo. Crea una clave aleatoria exclusiva de CUR y guárdala también en tu gestor de contraseñas. Usa `CUR_ALLOW_UNAUTHENTICATED_LOCAL` únicamente en `.dev.vars`.

## Despliegue

`wrangler.json` referencia la base D1 `cur` de este proyecto. Para desplegarlo en otra cuenta, sustituye `database_id` por el ID de tu propia base. Aplica las migraciones y configura los secretos remotos:

```sh
npx wrangler d1 migrations apply cur --remote
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put API_TOKEN
npx wrangler deploy
```

`GEMINI_API_KEY` habilita generar y evaluar rutas. Créala en [Google AI Studio](https://aistudio.google.com/apikey) y guárdala como secreto del Worker. El formulario de acceso de la web usa la clave independiente `API_TOKEN`. La API rechaza las solicitudes con 503 mientras falte `API_TOKEN` en el Worker. El modelo se define con `GEMINI_MODEL` en `wrangler.json` y usa `gemini-2.5-flash` por defecto.

## Importar cursos de Udemy

En **Catálogo → Importar Udemy**, pega el enlace directo a un curso de Udemy. CUR guarda el enlace con su cupón, si lo hay, y deja el precio como desconocido. Comprueba el precio final en Udemy antes de marcar el curso como gratis o de pago. Si vuelves a importar un curso existente con un cupón distinto, se actualiza únicamente su enlace y se conserva el progreso.

[Catálogo gratuito de Udemy](https://www.udemy.com/courses/free/) · [Cómo comprobar un cupón](https://support.udemy.com/hc/en-us/sections/206458408-Purchasing-a-course)

### Recibir cursos desde Telegram

1. Crea un bot en [@BotFather](https://t.me/BotFather) con `/newbot`. Guarda el token del bot para los trámites con Telegram.
2. Para empezar, abre el chat privado con tu bot, pulsa **Iniciar** y envíale un mensaje. Para importar automáticamente desde un grupo o canal, pide a su administrador que agregue el bot. En un grupo, recibir los mensajes ordinarios requiere que el bot sea administrador o que el modo de privacidad de grupo esté desactivado. Para publicaciones de otros bots, consulta [Bot-to-Bot Communication](https://core.telegram.org/bots/features#bot-to-bot-communication).
3. Antes de registrar el webhook, llama a [`getUpdates`](https://core.telegram.org/bots/api#getupdates) con el token del bot para obtener el `message.chat.id` o `channel_post.chat.id` de cada chat autorizado. Usa el ID completo, incluido el signo. El chat privado permite reenviar enlaces desde grupos ajenos cuando Telegram permite el reenvío.
4. En Cloudflare, abre **Workers y Pages → cur → Configuración → Variables y secretos**. Guarda `TELEGRAM_CHAT_IDS` con los IDs separados por comas y `TELEGRAM_WEBHOOK_SECRET` con una cadena aleatoria distinta del token del bot. Telegram admite letras, números, guiones y guiones bajos para este secreto. El Worker solo necesita esos dos valores.
5. Llama a [`setWebhook`](https://core.telegram.org/bots/api#setwebhook) por HTTPS con el token del bot. Pasa el mismo valor de `TELEGRAM_WEBHOOK_SECRET` en `secret_token`. Usa la URL del Worker que quieras conectar. Verifica el registro con [`getWebhookInfo`](https://core.telegram.org/bots/api#getwebhookinfo) y envía un enlace de Udemy desde un chat autorizado. El curso debe aparecer en el catálogo de CUR.

```json
{
  "url": "https://tu-worker.workers.dev/telegram/webhook",
  "secret_token": "el_mismo_secreto_guardado_en_cloudflare",
  "allowed_updates": ["message", "channel_post"]
}
```

Telegram entrega mensajes nuevos al webhook. CUR toma hasta 10 enlaces directos de Udemy por mensaje y guarda las fichas del curso con su enlace y cupón. Puedes probar el flujo localmente con las pruebas incluidas.

En PowerShell puedes completar los pasos 3 a 5 con este comando. Configura los dos valores en Cloudflare cuando aparezcan los IDs. Usa un bot nuevo para la prueba y el mismo secreto al registrar el webhook.

```powershell
$botToken = [System.Net.NetworkCredential]::new('', (Read-Host 'Token del bot' -AsSecureString)).Password
try {
  $telegramApi = "https://api.telegram.org/bot$botToken"
  $updates = (Invoke-RestMethod -Uri "$telegramApi/getUpdates" -Method Post -ErrorAction Stop).result
  $updates | ForEach-Object { $_.message.chat.id; $_.channel_post.chat.id } |
    Where-Object { $null -ne $_ } | Sort-Object -Unique

  $webhookUrl = Read-Host 'URL HTTPS completa del webhook, con /telegram/webhook'
  $hookSecret = [System.Net.NetworkCredential]::new('', (Read-Host 'TELEGRAM_WEBHOOK_SECRET' -AsSecureString)).Password
  $body = @{
    url = $webhookUrl
    secret_token = $hookSecret
    allowed_updates = @('message', 'channel_post')
  } | ConvertTo-Json -Compress
  $registration = Invoke-RestMethod -Uri "$telegramApi/setWebhook" -Method Post -ContentType 'application/json' -Body $body -ErrorAction Stop
  if (!$registration.ok) { throw 'Telegram no confirmó el registro' }
  Invoke-RestMethod -Uri "$telegramApi/getWebhookInfo" -ErrorAction Stop | Select-Object -ExpandProperty result
} catch {
  Write-Warning 'Telegram no completó la operación. Comprueba el token del bot, la URL del Worker y el estado del webhook.'
} finally {
  Remove-Variable botToken, telegramApi, hookSecret, body, updates -ErrorAction SilentlyContinue
}
```

## Pruebas

```sh
npm test
```

Las pruebas usan `node:sqlite` mediante un adaptador con la misma interfaz que D1; no requieren instalar dependencias ni una clave real de Gemini.

## API

Todas las respuestas son JSON. Con `API_TOKEN` configurado, envía `Authorization: Bearer <token>`.

- `GET /api/resumen`
- `GET|POST /api/cursos`
- `POST /api/cursos/importar-udemy` con `{ "url": "...", "title": "opcional" }`. Devuelve `{ "curso": { ... }, "creado": true }` con 201 al crear, o 200 y `creado: false` si ya existía.
- `PATCH|DELETE /api/cursos/:id`
- `GET /api/perfil`
- `PUT|DELETE /api/perfil/skills/:name`
- `PUT /api/perfil/settings`
- `POST /api/rutas/generar` con `{ "objetivo": "..." }`
- `POST /api/rutas/evaluar` con `{ "ruta": "..." }`
- `GET /api/rutas`

Los textos para generar o evaluar rutas tienen un máximo de 4000 caracteres. Las rutas generadas solo pueden recomendar cursos cuyos IDs existan en el catálogo.

## Estructura

- `src/worker.js`: entrada del Worker y configuración.
- `src/api.js`: rutas HTTP, autenticación y validación.
- `src/db.js`: acceso a D1.
- `src/gemini.js`: cliente REST de Gemini.
- `src/rutas.js`: prompts y normalización de respuestas de IA.
- `src/udemy.js`: normalización de enlaces y cupones.
- `src/telegram.js`: recepción de enlaces Udemy de chats autorizados.
- `public/`: interfaz sin dependencias.
- `migrations/`: esquema de D1.
- `test/`: pruebas de API.

Guía de formatos y tamaños del icono en [docs/favicon.md](docs/favicon.md).
