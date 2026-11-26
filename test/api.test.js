import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { handleApi } from '../src/api.js';
import { createGemini } from '../src/gemini.js';
import worker from '../src/worker.js';
import { sqliteD1 } from './helpers/d1-sqlite.js';

let db;
let fakeReply = null;
let geminiEnabled = true;
let lastPrompt;

const gemini = () => ({
  model: 'test-model',
  get enabled() { return geminiEnabled; },
  async generateJson(prompt) {
    lastPrompt = prompt;
    return fakeReply;
  },
});

before(() => {
  db = createDb(sqliteD1(['migrations/0001_init.sql']));
});

async function call(method, path, body) {
  const request = new Request(`http://test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleApi(request, { db, gemini: gemini() });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* respuesta no JSON */ }
  return { status: res.status, body: json, text };
}

test('crea, actualiza y elimina un curso', async () => {
  const created = await call('POST', '/api/cursos', {
    title: 'Python for Everybody', provider: 'Coursera', source: 'coursera',
    topics: 'python, datos', price: 'gratis', status: 'en_curso', progress: 20,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.topics, ['python', 'datos']);

  const id = created.body.id;
  const patched = await call('PATCH', `/api/cursos/${id}`, { progress: 55 });
  assert.equal(patched.body.progress, 55);

  const done = await call('PATCH', `/api/cursos/${id}`, { status: 'completado' });
  assert.equal(done.body.progress, 100, 'completar un curso fija el avance en 100');

  const del = await call('DELETE', `/api/cursos/${id}`);
  assert.equal(del.status, 200);
  assert.equal((await call('DELETE', `/api/cursos/${id}`)).status, 404);
});

test('rechaza datos inválidos de curso', async () => {
  assert.equal((await call('POST', '/api/cursos', { title: '' })).status, 400);
  assert.equal((await call('POST', '/api/cursos', { title: 'X', status: 'raro' })).status, 400);
  assert.equal((await call('POST', '/api/cursos', { title: 'X', progress: 150 })).status, 400);
  assert.equal((await call('POST', '/api/cursos', { title: 'X', price: 'caro' })).status, 400);
});

test('importa Udemy una vez, conserva el cupón y deja el precio sin verificar', async () => {
  const path = '/api/cursos/importar-udemy';
  const results = await Promise.all([
    call('POST', path, { url: 'https://udemy.com/course/introduccion-a-udemy/?couponCode=CURSO-2026&utm_source=x#info' }),
    call('POST', path, { url: 'https://www.udemy.com/course/introduccion-a-udemy' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  const original = results.find((r) => r.status === 201).body;
  assert.equal(original.creado, true);
  assert.equal(original.curso.title, 'Introduccion a udemy');
  assert.equal(original.curso.provider, 'Udemy');
  assert.equal(original.curso.source, 'udemy');
  assert.equal(original.curso.price, 'desconocido');
  assert.equal(results[0].body.curso.id, results[1].body.curso.id);
  assert.equal((await db.getCourse(original.curso.id)).url,
    'https://www.udemy.com/course/introduccion-a-udemy/?couponCode=CURSO-2026');
  assert.equal((await call('POST', path, { url: 'https://www.udemy.com.example.org/course/falso/' })).status, 400);
  assert.equal((await call('POST', path, { url: 'https://www.udemy.com/course/falso/learn/' })).status, 400);
  assert.equal((await call('POST', path, { url: 'http://udemy.com/course/falso/' })).status, 400);
  assert.equal((await call('POST', path, null)).status, 400);
});

test('un cupón nuevo reutiliza una fila anterior y conserva el progreso', async () => {
  const previous = await db.createCourse({
    title: 'Título guardado', provider: 'Udemy', source: 'manual', status: 'en_curso',
    url: 'https://udemy.com/course/curso-anterior/#intro', progress: 65, price: 'pago', notes: 'Notas guardadas',
  });
  const result = await call('POST', '/api/cursos/importar-udemy', {
    url: 'https://www.udemy.com/course/curso-anterior?couponCode=OFERTA',
    title: 'Opción nueva',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.creado, false);
  assert.deepEqual(result.body.curso, {
    ...previous, updated_at: result.body.curso.updated_at,
    url: 'https://www.udemy.com/course/curso-anterior/?couponCode=OFERTA',
  });
});

test('el webhook de Telegram solo importa enlaces de chats autorizados con el secreto correcto', async () => {
  const binding = sqliteD1(['migrations/0001_init.sql']);
  const env = {
    DB: binding,
    TELEGRAM_WEBHOOK_SECRET: 'secret-test',
    TELEGRAM_CHAT_IDS: '91, -1001234',
  };
  const dispatch = (update, secret = 'secret-test', config = env) => worker.fetch(
    new Request('https://cur.test/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify(update),
    }),
    config,
  );
  const update = {
    channel_post: {
      chat: { id: -1001234 },
      caption: 'Curso https://www.udemy.com/course/curso-telegram/?couponCode=OFERTA). y otro',
      caption_entities: [{ type: 'text_link', url: 'https://udemy.com/course/curso-oculto/' }],
    },
  };
  const courses = createDb(binding);
  assert.equal((await dispatch(update, 'secret-test', { ...env, TELEGRAM_CHAT_IDS: '' })).status, 404);
  assert.equal((await dispatch(update, 'incorrecto')).status, 403);
  assert.equal((await dispatch({ message: { ...update.channel_post, chat: { id: -10012345 } } })).status, 204);
  assert.equal((await dispatch({ edited_channel_post: update.channel_post })).status, 204);
  assert.deepEqual(await courses.listCourses(), []);

  assert.equal((await dispatch(update)).status, 204);
  assert.equal((await dispatch(update)).status, 204);
  const saved = await courses.listCourses();
  assert.deepEqual(saved.map(({ url }) => url).sort(), [
    'https://www.udemy.com/course/curso-oculto/',
    'https://www.udemy.com/course/curso-telegram/?couponCode=OFERTA',
  ]);
  assert.ok(saved.every(({ source, price }) => source === 'telegram' && price === 'desconocido'));
});

test('resumen separa cursos en curso y completados', async () => {
  await call('POST', '/api/cursos', { title: 'Curso A', status: 'en_curso', progress: 40 });
  await call('POST', '/api/cursos', { title: 'Curso B', status: 'completado', progress: 100 });
  const { body } = await call('GET', '/api/resumen');
  assert.ok(body.totales.en_curso >= 1);
  assert.ok(body.totales.completado >= 1);
  assert.ok(body.en_curso.every((c) => c.status === 'en_curso'));
  assert.ok(body.completados.every((c) => c.status === 'completado'));
});

test('skills y ajustes del perfil', async () => {
  assert.equal((await call('PUT', '/api/perfil/skills/Python', { level: 3 })).status, 200);
  assert.equal((await call('PUT', '/api/perfil/skills/Python', { level: 9 })).status, 400);
  const settings = await call('PUT', '/api/perfil/settings', { horas_semana: 6, presupuesto: 'gratis' });
  assert.equal(settings.body.horas_semana, '6');
  assert.equal(settings.body.presupuesto, 'gratis');
  const perfil = await call('GET', '/api/perfil');
  assert.deepEqual(perfil.body.skills.find((s) => s.name === 'Python'), { name: 'Python', level: 3 });
});

test('generar ruta descarta ids inventados y acepta ids en texto', async () => {
  const curso = (await call('POST', '/api/cursos', { title: 'SQL básico', topics: ['sql'], price: 'gratis' })).body;
  fakeReply = {
    titulo: 'Ruta de datos',
    resumen: 'Resumen',
    semanas_estimadas: 6,
    modulos: [
      { orden: 2, tema: 'SQL', objetivo: 'Consultas', horas_estimadas: 10, course_id: String(curso.id), recurso_sugerido: null },
      { orden: 1, tema: 'Estadística', objetivo: 'Bases', horas_estimadas: 8, course_id: 99999, recurso_sugerido: 'Curso de estadística descriptiva' },
    ],
    temas_omitidos: [{ tema: 'Python', motivo: 'Ya lo domina' }],
  };
  const res = await call('POST', '/api/rutas/generar', { objetivo: 'Quiero analizar datos' });
  assert.equal(res.status, 200);
  assert.equal(res.body.modulos[0].tema, 'Estadística', 'los módulos se ordenan por orden');
  assert.equal(res.body.modulos[0].course_id, null, 'id inexistente se descarta');
  assert.equal(res.body.modulos[0].recurso_sugerido, 'Curso de estadística descriptiva');
  assert.equal(res.body.modulos[1].course_id, curso.id, 'id en texto se normaliza');
  assert.equal(res.body.modulos[1].recurso_sugerido, null);
  assert.ok(res.body.id > 0);
});

test('evaluar ruta filtra cursos recomendados que no existen y normaliza veredicto', async () => {
  fakeReply = {
    veredicto: 'algo_raro',
    puntaje: 180,
    resumen: 'Encaja a medias',
    brechas: [{ tema: 'Docker', nivel_requerido: 3, nivel_actual: null, accion: 'Curso introductorio' }],
    orden_sugerido: ['Git', 'Docker'],
    cursos_recomendados: [{ course_id: 424242, razon: 'inventado' }],
  };
  const res = await call('POST', '/api/rutas/evaluar', { ruta: 'Git, Docker, Kubernetes' });
  assert.equal(res.status, 200);
  assert.equal(res.body.veredicto, 'encaja_parcialmente');
  assert.equal(res.body.puntaje, 100);
  assert.deepEqual(res.body.cursos_recomendados, []);
  assert.equal(res.body.brechas[0].nivel_actual, null);
});

test('rutas devuelve 503 si falta la clave de Gemini', async () => {
  geminiEnabled = false;
  try {
    const res = await call('POST', '/api/rutas/generar', { objetivo: 'hola mundo' });
    assert.equal(res.status, 503);
  } finally {
    geminiEnabled = true;
  }
});

test('ruta de API desconocida responde 404 en JSON', async () => {
  const res = await call('GET', '/api/no-existe');
  assert.equal(res.status, 404);
  assert.match(res.body.error, /no encontrada/);
});

test('una ruta conocida con método incorrecto responde 405', async () => {
  assert.equal((await call('PUT', '/api/cursos', {})).status, 405);
});

test('un nombre de skill mal codificado responde 400', async () => {
  assert.equal((await call('DELETE', '/api/perfil/skills/%ZZ')).status, 400);
});

test('reducir el avance de un curso completado lo devuelve a en curso', async () => {
  const curso = (await call('POST', '/api/cursos', { title: 'Docker', status: 'completado' })).body;
  const reduced = await call('PATCH', `/api/cursos/${curso.id}`, { progress: 50 });
  assert.equal(reduced.status, 200);
  assert.equal(reduced.body.status, 'en_curso');
  assert.equal(reduced.body.progress, 50);

  await call('PATCH', `/api/cursos/${curso.id}`, { status: 'completado' });
  const reopened = await call('PATCH', `/api/cursos/${curso.id}`, { status: 'catalogo' });
  assert.equal(reopened.body.progress, 0);
});

test('limita los textos enviados a Gemini', async () => {
  const largo = 'a'.repeat(4001);
  assert.equal((await call('POST', '/api/rutas/generar', { objetivo: largo })).status, 400);
  assert.equal((await call('POST', '/api/rutas/evaluar', { ruta: largo })).status, 400);
});

test('API_TOKEN exige autorización Bearer cuando está configurado', async () => {
  const unauthenticated = await handleApi(new Request('http://test/api/resumen'), {
    db, gemini: gemini(), apiToken: 'secreto',
  });
  assert.equal(unauthenticated.status, 401);

  const authorized = await handleApi(new Request('http://test/api/resumen', {
    headers: { Authorization: 'Bearer secreto' },
  }), { db, gemini: gemini(), apiToken: 'secreto' });
  assert.equal(authorized.status, 200);
});

test('el presupuesto solo gratis restringe los candidatos y las referencias de ambas rutas', async () => {
  const curso = async (title, price) => (await call('POST', '/api/cursos', { title, price })).body.id;
  const free = await curso('Curso gratuito', 'gratis');
  const paid = await curso('Curso de pago', 'pago');
  const unknown = await curso('Curso de precio desconocido', 'desconocido');
  const ids = [free, paid, unknown];
  const catalog = () => JSON.parse(lastPrompt.user.split('\n\nCatálogo disponible (JSON):\n').at(-1));

  await call('PUT', '/api/perfil/settings', { presupuesto: 'gratis' });
  fakeReply = { modulos: ids.map((id) => ({ tema: 'Tema', course_id: id })) };
  const generated = await call('POST', '/api/rutas/generar', { objetivo: 'Aprender SQL' });
  assert.equal(generated.status, 200);
  assert.deepEqual(generated.body.modulos.map((m) => m.course_id), [free, null, null]);
  assert.ok(catalog().some((c) => c.id === free));
  assert.ok(catalog().every((c) => c.precio === 'gratis'));

  fakeReply = {
    veredicto: 'encaja', puntaje: 90, resumen: 'Adecuada',
    cursos_recomendados: ids.map((id) => ({ course_id: id })),
  };
  const evaluated = await call('POST', '/api/rutas/evaluar', { ruta: 'Ruta de SQL' });
  assert.equal(evaluated.status, 200);
  assert.deepEqual(evaluated.body.cursos_recomendados.map((c) => c.course_id), [free]);
  assert.ok(catalog().every((c) => c.precio === 'gratis'));

  await call('PUT', '/api/perfil/settings', { presupuesto: 'pago' });
  const unrestricted = await call('POST', '/api/rutas/evaluar', { ruta: 'Ruta de SQL' });
  assert.deepEqual(unrestricted.body.cursos_recomendados.map((c) => c.course_id), ids);
});

test('valida todas las preferencias antes de guardar y permite borrar las horas', async () => {
  const baseline = await call('PUT', '/api/perfil/settings', { horas_semana: 6, idioma: 'es', presupuesto: 'gratis' });
  assert.equal(baseline.status, 200);

  const rejected = await call('PUT', '/api/perfil/settings', { horas_semana: 12, idioma: 'en', presupuesto: 'inválido' });
  assert.equal(rejected.status, 400);
  assert.deepEqual((await call('GET', '/api/perfil')).body.settings, baseline.body);

  assert.equal((await call('PUT', '/api/perfil/settings', { horas_semana: 0 })).body.horas_semana, '0');
  assert.equal((await call('PUT', '/api/perfil/settings', { idioma: 'en' })).body.horas_semana, '0');

  const cleared = await call('PUT', '/api/perfil/settings', { horas_semana: '', idioma: 'fr' });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body, { horas_semana: null, idioma: 'fr', presupuesto: 'gratis' });
  assert.deepEqual((await call('GET', '/api/perfil')).body.settings, cleared.body);
});

test('si falla una escritura de preferencias se revierte el lote completo', async () => {
  const binding = sqliteD1(['migrations/0001_init.sql']);
  const profileDb = createDb(binding);
  await profileDb.setSettings({ horas_semana: 6 });
  await binding.prepare(`
    CREATE TRIGGER reject_language BEFORE INSERT ON settings
    WHEN NEW.key = 'idioma' BEGIN
      SELECT RAISE(ABORT, 'idioma rechazado');
    END
  `).run();

  await assert.rejects(profileDb.setSettings({ horas_semana: null, idioma: 'en' }), /idioma rechazado/);
  assert.deepEqual(await profileDb.getSettings(), { horas_semana: '6', idioma: 'es', presupuesto: 'cualquiera' });
});

test('las respuestas de Gemini incompletas o mal formadas no se guardan', async () => {
  const history = (await call('GET', '/api/rutas')).body;
  const cases = [
    ['generar', { objetivo: 'Aprender SQL' }, null],
    ['generar', { objetivo: 'Aprender SQL' }, {}],
    ['generar', { objetivo: 'Aprender SQL' }, { modulos: [] }],
    ['generar', { objetivo: 'Aprender SQL' }, { modulos: [null] }],
    ['evaluar', { ruta: 'Ruta de SQL' }, { veredicto: 'encaja' }],
    ['evaluar', { ruta: 'Ruta de SQL' }, { veredicto: 'encaja', puntaje: 95, resumen: 'Adecuada', brechas: [null] }],
  ];

  for (const [action, body, reply] of cases) {
    fakeReply = reply;
    const result = await call('POST', `/api/rutas/${action}`, body);
    assert.equal(result.status, 502);
    assert.match(result.body.error, /Vuelve a intentarlo/);
  }
  assert.deepEqual((await call('GET', '/api/rutas')).body, history);
});

test('un cuerpo HTTP ilegible de Gemini devuelve un error que permite reintentar', async () => {
  const client = createGemini({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async () => new Response('cuerpo inválido'),
  });
  const req = new Request('http://test/api/rutas/generar', {
    method: 'POST',
    body: JSON.stringify({ objetivo: 'Aprender SQL' }),
  });
  const result = await handleApi(req, { db, gemini: client });
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /Vuelve a intentarlo/);
});
