import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { handleApi } from '../src/api.js';
import { sqliteD1 } from './helpers/d1-sqlite.js';

let db;
let fakeReply = null;
let geminiEnabled = true;

const gemini = () => ({
  model: 'test-model',
  get enabled() { return geminiEnabled; },
  async generateJson() { return fakeReply; },
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
  const curso = (await call('POST', '/api/cursos', { title: 'SQL básico', topics: ['sql'] })).body;
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
