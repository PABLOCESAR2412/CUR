import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;
let db;
let fakeReply = null;
let gemini;

function fakeGemini({ enabled = true, reply = () => ({}) } = {}) {
  return {
    model: 'test-model',
    enabled,
    async generateJson() {
      return reply();
    },
  };
}

before(async () => {
  db = openDb(':memory:');
  const publicDir = mkdtempSync(join(tmpdir(), 'cursos-public-'));
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>ok</title>');
  mkdirSync(join(publicDir, 'sub'));
  gemini = fakeGemini({ reply: () => fakeReply });
  const handler = createApp({ db, gemini, publicDir });
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* respuesta no JSON */ }
  return { status: res.status, body: json, text };
};

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
  const disabled = createApp({ db, gemini: fakeGemini({ enabled: false }), publicDir: '/tmp' });
  const s = createServer(disabled);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/rutas/generar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objetivo: 'hola mundo' }),
    });
    assert.equal(res.status, 503);
  } finally {
    s.close();
  }
});

test('no sirve archivos fuera de public/', async () => {
  const res = await fetch(`${base}/..%2Fpackage.json`);
  assert.notEqual(res.status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
});
