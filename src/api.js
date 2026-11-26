import { STATUSES, PRICES } from './db.js';
import { compactCatalog, describePerfil, promptGenerar, promptEvaluar, validarGenerar, validarEvaluar } from './rutas.js';
import { parseUdemyUrl } from './udemy.js';

const MAX_BODY = 200_000;
const MAX_RUTA_TEXT = 4_000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Cuerpo demasiado grande');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

// Normaliza y valida un curso. Con partial=true solo revisa los campos presentes.
function parseCourse(input, partial = false) {
  const out = {};
  const has = (k) => input[k] !== undefined;
  if (!partial || has('title')) {
    if (typeof input.title !== 'string' || !input.title.trim()) throw new HttpError(400, 'El título es obligatorio');
    out.title = input.title.trim();
  }
  for (const k of ['provider', 'source', 'url', 'level', 'notes']) {
    if (has(k)) out[k] = input[k] === null || input[k] === '' ? null : String(input[k]).trim();
  }
  if (has('hours')) {
    const h = input.hours === null || input.hours === '' ? null : Number(input.hours);
    if (h !== null && (!Number.isFinite(h) || h < 0)) throw new HttpError(400, 'Horas inválidas');
    out.hours = h;
  }
  if (has('topics')) {
    const list = Array.isArray(input.topics) ? input.topics : String(input.topics).split(',');
    out.topics = list.map((t) => String(t).trim()).filter(Boolean);
  }
  if (has('price')) {
    if (!PRICES.includes(input.price)) throw new HttpError(400, `price debe ser uno de: ${PRICES.join(', ')}`);
    out.price = input.price;
  }
  if (has('status')) {
    if (!STATUSES.includes(input.status)) throw new HttpError(400, `status debe ser uno de: ${STATUSES.join(', ')}`);
    out.status = input.status;
  }
  if (has('progress')) {
    const p = Number(input.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) throw new HttpError(400, 'progress debe ser un entero de 0 a 100');
    out.progress = p;
  }
  return out;
}

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Id inválido');
  return id;
};

async function handleRuta(kind, body, { db, gemini }) {
  if (!gemini.enabled) throw new HttpError(503, 'Falta GEMINI_API_KEY: configúrala para usar las rutas con IA');
  const cursos = await db.listCourses();
  const settings = await db.getSettings();
  const perfil = describePerfil(await db.listSkills(), settings);
  const candidatos = settings.presupuesto === 'gratis' ? cursos.filter((curso) => curso.price === 'gratis') : cursos;
  const catalogo = compactCatalog(candidatos);
  const ids = new Set(catalogo.map((curso) => curso.id));

  if (kind === 'generar') {
    const objetivo = typeof body.objetivo === 'string' ? body.objetivo.trim() : '';
    if (objetivo.length < 3) throw new HttpError(400, 'Describe tu objetivo (mínimo 3 caracteres)');
    if (objetivo.length > MAX_RUTA_TEXT) throw new HttpError(400, `El objetivo no puede superar ${MAX_RUTA_TEXT} caracteres`);
    const raw = await gemini.generateJson(promptGenerar({ objetivo, catalogo, perfil }));
    const resultado = validarGenerar(raw, ids);
    const id = await db.saveRuta({ tipo: 'generar', objetivo, resultado });
    return { id, ...resultado };
  }

  const ruta = typeof body.ruta === 'string' ? body.ruta.trim() : '';
  if (ruta.length < 3) throw new HttpError(400, 'Escribe la ruta que quieres evaluar');
  if (ruta.length > MAX_RUTA_TEXT) throw new HttpError(400, `La ruta no puede superar ${MAX_RUTA_TEXT} caracteres`);
  const raw = await gemini.generateJson(promptEvaluar({ ruta, catalogo, perfil }));
  const resultado = validarEvaluar(raw, ids);
  const id = await db.saveRuta({ tipo: 'evaluar', objetivo: ruta, resultado });
  return { id, ...resultado };
}

function knownPath(path) {
  return ['/api/resumen', '/api/cursos', '/api/cursos/importar-udemy', '/api/perfil', '/api/perfil/settings', '/api/rutas/generar', '/api/rutas/evaluar', '/api/rutas'].includes(path)
    || /^\/api\/cursos\/\d+$/.test(path)
    || /^\/api\/perfil\/skills\/[^/]+$/.test(path);
}

async function route(request, url, deps) {
  const { db } = deps;
  const path = url.pathname;
  const m = request.method;
  const body = m === 'POST' || m === 'PUT' || m === 'PATCH' ? await readJson(request) : {};

  if (m === 'GET' && path === '/api/resumen') return [200, await db.resumen()];

  if (path === '/api/cursos') {
    if (m === 'GET') {
      const status = url.searchParams.get('status') ?? undefined;
      if (status && !STATUSES.includes(status)) throw new HttpError(400, 'status inválido');
      return [200, await db.listCourses({ status })];
    }
    if (m === 'POST') return [201, await db.createCourse(parseCourse(body))];
  }

  if (m === 'POST' && path === '/api/cursos/importar-udemy') {
    const course = parseUdemyUrl(body?.url);
    if (!course) throw new HttpError(400, 'Pega un enlace directo a un curso de Udemy.');
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.length > 200) throw new HttpError(400, 'Título inválido.');
      course.title = body.title.trim() || course.title;
    }
    const result = await db.importUdemy(course, 'udemy');
    if (!result.curso) throw new HttpError(409, 'El catálogo cambió durante la importación. Vuelve a intentarlo.');
    return [result.creado ? 201 : 200, result];
  }

  const cursoMatch = path.match(/^\/api\/cursos\/(\d+)$/);
  if (cursoMatch) {
    const id = parseId(cursoMatch[1]);
    if (m === 'PATCH') {
      const updated = await db.updateCourse(id, parseCourse(body, true));
      if (!updated) throw new HttpError(404, 'Curso no encontrado');
      return [200, updated];
    }
    if (m === 'DELETE') {
      if (!await db.deleteCourse(id)) throw new HttpError(404, 'Curso no encontrado');
      return [200, { ok: true }];
    }
  }

  if (m === 'GET' && path === '/api/perfil') {
    return [200, { skills: await db.listSkills(), settings: await db.getSettings() }];
  }

  const skillMatch = path.match(/^\/api\/perfil\/skills\/([^/]+)$/);
  if (skillMatch) {
    let name;
    try {
      name = decodeURIComponent(skillMatch[1]).trim();
    } catch {
      throw new HttpError(400, 'Nombre de skill mal codificado');
    }
    if (!name) throw new HttpError(400, 'Nombre de skill vacío');
    if (m === 'PUT') {
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 1 || level > 5) throw new HttpError(400, 'El nivel va de 1 a 5');
      await db.setSkill(name, level);
      return [200, { skills: await db.listSkills() }];
    }
    if (m === 'DELETE') {
      if (!await db.deleteSkill(name)) throw new HttpError(404, 'Skill no encontrada');
      return [200, { skills: await db.listSkills() }];
    }
  }

  if (m === 'PUT' && path === '/api/perfil/settings') {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Las preferencias deben enviarse como un objeto');
    }

    const settings = {};
    const hours = body.horas_semana;
    if (hours === null || (typeof hours === 'string' && hours.trim() === '')) {
      settings.horas_semana = null;
    } else if (hours !== undefined) {
      if (typeof hours !== 'number' && typeof hours !== 'string') {
        throw new HttpError(400, 'Horas por semana inválidas');
      }
      const value = Number(hours);
      if (!Number.isFinite(value) || value < 0 || value > 168) {
        throw new HttpError(400, 'Horas por semana inválidas');
      }
      settings.horas_semana = value;
    }
    if (body.idioma !== undefined) {
      if (typeof body.idioma !== 'string') throw new HttpError(400, 'Idioma inválido');
      settings.idioma = body.idioma.trim() || 'es';
    }
    if (body.presupuesto !== undefined) {
      if (!['gratis', 'pago', 'cualquiera'].includes(body.presupuesto)) throw new HttpError(400, 'Presupuesto inválido');
      settings.presupuesto = body.presupuesto;
    }
    await db.setSettings(settings);
    return [200, await db.getSettings()];
  }

  if (m === 'POST' && path === '/api/rutas/generar') return [200, await handleRuta('generar', body, deps)];
  if (m === 'POST' && path === '/api/rutas/evaluar') return [200, await handleRuta('evaluar', body, deps)];
  if (m === 'GET' && path === '/api/rutas') return [200, await db.listRutas()];

  if (knownPath(path)) throw new HttpError(405, 'Método no permitido');
  throw new HttpError(404, 'Ruta no encontrada');
}

// Punto de entrada de la API. Devuelve siempre una Response JSON.
export async function handleApi(request, deps) {
  const url = new URL(request.url);
  try {
    if (deps.apiToken && request.headers.get('Authorization') !== `Bearer ${deps.apiToken}`) {
      throw new HttpError(401, 'Token de acceso inválido o ausente');
    }
    const [status, payload] = await route(request, url, deps);
    return json(status, payload);
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    return json(status, { error: status === 500 ? 'Error interno' : err.message });
  }
}
