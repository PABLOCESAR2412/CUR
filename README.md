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
# Opcional: exige este token en todas las solicitudes a /api/
API_TOKEN=un_token_largo_y_aleatorio
```

Crea la base D1 y copia el `database_id` devuelto en `wrangler.json`:

```sh
npx wrangler d1 create cur
npx wrangler d1 migrations apply cur --local
npx wrangler dev
```

Si configuras `API_TOKEN`, la interfaz pedirá el token al recibir una respuesta 401 y lo guardará en el navegador. Sin `API_TOKEN`, la API queda abierta; úsalo siempre en un despliegue accesible públicamente o protege el Worker con Cloudflare Access.

## Despliegue

Tras configurar el `database_id`, aplica las migraciones y secretos remotos:

```sh
npx wrangler d1 migrations apply cur --remote
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put API_TOKEN
npx wrangler deploy
```

`GEMINI_API_KEY` habilita generar y evaluar rutas. `API_TOKEN` es opcional, pero recomendado. El modelo se define con `GEMINI_MODEL` en `wrangler.json` y usa `gemini-2.5-flash` por defecto.

## Pruebas

```sh
npm test
```

Las pruebas usan `node:sqlite` mediante un adaptador con la misma interfaz que D1; no requieren instalar dependencias ni una clave real de Gemini.

## API

Todas las respuestas son JSON. Con `API_TOKEN` configurado, envía `Authorization: Bearer <token>`.

- `GET /api/resumen`
- `GET|POST /api/cursos`
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
- `public/`: interfaz sin dependencias.
- `migrations/`: esquema de D1.
- `test/`: pruebas de API.
