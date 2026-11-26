import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createGemini } from './src/gemini.js';
import { createApp } from './src/app.js';

const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(root, 'data', 'cursos.db');
const port = Number(process.env.PORT ?? 3000);

mkdirSync(dirname(dbPath), { recursive: true });

const db = openDb(dbPath);
const gemini = createGemini({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
});

const handler = createApp({ db, gemini, publicDir: join(root, 'public') });

// Solo escucha en localhost: es una app personal, no debe quedar expuesta en la red.
createServer(handler).listen(port, '127.0.0.1', () => {
  console.log(`Cursos Hub en http://localhost:${port}  (modelo: ${gemini.model}, IA ${gemini.enabled ? 'activa' : 'desactivada'})`);
});
