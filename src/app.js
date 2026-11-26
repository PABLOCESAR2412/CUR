import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { STATUSES, PRICES } from './db.js';
import { compactCatalog, describePerfil, promptGenerar, promptEvaluar, validarGenerar, validarEvaluar } from './rutas.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const MAX_BODY = 200_000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Cuerpo demasiado grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Normaliza y valida un curso. Con partial=true solo revisa los campos presentes.
function parseCourse(input, partial = false) {
  const out = {};
  const pick = (k) => partial ? input[k] !== undefined : true;
  if (pick('title')) {
    if (typeof input.title !== 'string' || !input.title.trim()) throw new HttpError(400, 'El título es obligatorio');
    out.title = input.title.trim();
  }
  for (const k of ['provider', 'source', 'url', 'level', 'notes']) {
    if (input[k] !== undefined) out[k] = input[k] === null || input[k] === '' ? null : String(input[k]).trim();
  }
  if (input.hours !== undefined) {
    const h = input.hours === null || input.hours === '' ? null : Number(input.hours);
    if (h !== null && (!Number.isFinite(h) || h < 0)) throw new HttpError(400, 'Horas inválidas');
    out.hours = h;
  }
  if (input.topics !== undefined) {
    const list = Array.isArray(input.topics) ? input.topics : String(input.topics).split(',');
    out.topics = list.map((t) => String(t).trim()).filter(Boolean);
  }
  if (input.price !== undefined) {
    if (!PRICES.includes(input.price)) throw new HttpError(400, `price debe ser uno de: ${PRICES.join(', ')}`);
    out.price = input.price;
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new HttpError(400, `status debe ser uno de: ${STATUSES.join(', ')}`);
    out.status = input.status;
  }
  if (input.progress !== undefined) {
    const p = Number(input.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) throw new HttpError(400, 'progress debe ser un entero de 0 a 100');
    out.progress = p;
  }
  return out;
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Id inválido');
  return id;
}

export function createApp({ db, gemini, publicDir }) {
  const catalogoValido = () => {
    const cursos = db.listCourses();
    return { cursos, ids: new Set(cursos.map((c) => c.id)) };
  };

  async function handleRuta(kind, body) {
    if (!gemini.enabled) throw new HttpError(503, 'Falta GEMINI_API_KEY: configúrala para usar las rutas con IA');
    const { cursos, ids } = catalogoValido();
    const perfil = describePerfil(db.listSkills(), db.getSettings());
    const catalogo = compactCatalog(cursos);

    if (kind === 'generar') {
      const objetivo = typeof body.objetivo === 'string' ? body.objetivo.trim() : '';
      if (objetivo.length < 3) throw new HttpError(400, 'Describe tu objetivo (mínimo 3 caracteres)');
      const prompt = promptGenerar({ objetivo, catalogo, perfil });
      const raw = await gemini.generateJson(prompt);
      const resultado = validarGenerar(raw, ids);
      const id = db.saveRuta({ tipo: 'generar', objetivo, resultado });
      return { id, ...resultado };
    }

    const ruta = typeof body.ruta === 'string' ? body.ruta.trim() : '';
    if (ruta.length < 3) throw new HttpError(400, 'Escribe la ruta que quieres evaluar');
    const prompt = promptEvaluar({ ruta, catalogo, perfil });
    const raw = await gemini.generateJson(prompt);
    const resultado = validarEvaluar(raw, ids);
    const id = db.saveRuta({ tipo: 'evaluar', objetivo: ruta, resultado });
    return { id, ...resultado };
  }

  async function route(req, url) {
    const path = url.pathname;
    const m = req.method;
    const body = m === 'POST' || m === 'PUT' || m === 'PATCH' ? await readJson(req) : {};

    if (m === 'GET' && path === '/api/resumen') return [200, db.resumen()];

    if (path === '/api/cursos') {
      if (m === 'GET') {
        const status = url.searchParams.get('status') ?? undefined;
        if (status && !STATUSES.includes(status)) throw new HttpError(400, 'status inválido');
        return [200, db.listCourses({ status })];
      }
      if (m === 'POST') {
        const data = parseCourse(body);
        return [201, db.createCourse(data)];
      }
    }

    const cursoMatch = path.match(/^\/api\/cursos\/(\d+)$/);
    if (cursoMatch) {
      const id = parseId(cursoMatch[1]);
      if (m === 'PATCH') {
        const updated = db.updateCourse(id, parseCourse(body, true));
        if (!updated) throw new HttpError(404, 'Curso no encontrado');
        return [200, updated];
      }
      if (m === 'DELETE') {
        if (!db.deleteCourse(id)) throw new HttpError(404, 'Curso no encontrado');
        return [200, { ok: true }];
      }
    }

    if (m === 'GET' && path === '/api/perfil') {
      return [200, { skills: db.listSkills(), settings: db.getSettings() }];
    }

    const skillMatch = path.match(/^\/api\/perfil\/skills\/([^/]+)$/);
    if (skillMatch) {
      const name = decodeURIComponent(skillMatch[1]).trim();
      if (!name) throw new HttpError(400, 'Nombre de skill vacío');
      if (m === 'PUT') {
        const level = Number(body.level);
        if (!Number.isInteger(level) || level < 1 || level > 5) throw new HttpError(400, 'El nivel va de 1 a 5');
        db.setSkill(name, level);
        return [200, { skills: db.listSkills() }];
      }
      if (m === 'DELETE') {
        if (!db.deleteSkill(name)) throw new HttpError(404, 'Skill no encontrada');
        return [200, { skills: db.listSkills() }];
      }
    }

    if (m === 'PUT' && path === '/api/perfil/settings') {
      if (body.horas_semana !== undefined && body.horas_semana !== null && body.horas_semana !== '') {
        const h = Number(body.horas_semana);
        if (!Number.isFinite(h) || h < 0 || h > 168) throw new HttpError(400, 'Horas por semana inválidas');
        db.setSetting('horas_semana', h);
      }
      if (body.idioma !== undefined) db.setSetting('idioma', String(body.idioma).trim() || 'es');
      if (body.presupuesto !== undefined) {
        if (!['gratis', 'pago', 'cualquiera'].includes(body.presupuesto)) throw new HttpError(400, 'Presupuesto inválido');
        db.setSetting('presupuesto', body.presupuesto);
      }
      return [200, db.getSettings()];
    }

    if (m === 'POST' && path === '/api/rutas/generar') return [200, await handleRuta('generar', body)];
    if (m === 'POST' && path === '/api/rutas/evaluar') return [200, await handleRuta('evaluar', body)];
    if (m === 'GET' && path === '/api/rutas') return [200, db.listRutas()];

    throw new HttpError(404, 'Ruta no encontrada');
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const full = normalize(join(publicDir, rel));
    if (!full.startsWith(publicDir + sep)) throw new HttpError(403, 'Acceso denegado');
    try {
      const data = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      throw new HttpError(404, 'No encontrado');
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const [status, payload] = await route(req, url);
        return send(res, status, payload);
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
      return await serveStatic(res, url.pathname);
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      if (url.pathname.startsWith('/api/')) return send(res, status, { error: err.message });
      res.writeHead(status);
      res.end(err.message);
    }
  };
}
