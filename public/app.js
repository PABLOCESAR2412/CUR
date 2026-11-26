const $ = (sel) => document.querySelector(sel);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');

const STATUS_LABEL = { catalogo: 'Guardado', en_curso: 'En curso', completado: 'Completado' };
const PRICE_LABEL = { gratis: 'Gratis', pago: 'Pago', desconocido: 'Precio desconocido' };
const VERDICT_LABEL = { encaja: 'Encaja', encaja_parcialmente: 'Encaja parcialmente', no_encaja: 'No encaja' };

let cursosPorId = new Map();

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

function setMsg(el, text, kind = '') {
  el.textContent = text;
  el.className = `msg ${kind}`.trim();
}

const tituloDe = (id) => cursosPorId.get(Number(id))?.title ?? `Curso #${id}`;

async function cargarCursosCache() {
  const cursos = await api('GET', '/api/cursos');
  cursosPorId = new Map(cursos.map((c) => [c.id, c]));
  return cursos;
}

// ---------- Tarjeta de curso (usada en avance y catálogo) ----------
function cursoHtml(c) {
  const meta = [c.provider, c.source, PRICE_LABEL[c.price], c.hours ? `${c.hours} h` : null]
    .filter(Boolean).map(esc).join(' · ');
  return `
  <div class="item">
    <div class="item-head">
      <span class="item-title">${esc(c.title)}</span>
      <span class="meta">${meta}</span>
    </div>
    ${c.topics.length ? `<div class="meta">${c.topics.map((t) => esc(t)).join(' · ')}</div>` : ''}
    <div class="barra" role="progressbar" aria-valuenow="${c.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${c.progress}%"></span></div>
    <div class="acciones">
      <span class="meta">${c.progress}%</span>
      <select data-action="estado" data-id="${c.id}" aria-label="Estado">
        ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === c.status ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${c.status === 'en_curso' ? `<input type="range" min="0" max="100" step="5" value="${c.progress}" data-action="progreso" data-id="${c.id}" aria-label="Avance del curso">` : ''}
      ${c.url ? `<a class="meta" href="${safeUrl(c.url)}" target="_blank" rel="noopener">Abrir</a>` : ''}
      <button class="peligro" data-action="borrar" data-id="${c.id}">Eliminar</button>
    </div>
  </div>`;
}

// ---------- Avance ----------
async function cargarAvance() {
  const r = await api('GET', '/api/resumen');
  $('#totales').innerHTML = [
    ['Guardados', r.totales.catalogo],
    ['En curso', r.totales.en_curso],
    ['Completados', r.totales.completado],
  ].map(([l, n]) => `<div class="total"><b>${n}</b><span>${l}</span></div>`).join('');
  $('#en-curso').innerHTML = r.en_curso.length
    ? r.en_curso.map(cursoHtml).join('')
    : '<p class="vacio">No tienes cursos en curso. Agrega uno desde Catálogo.</p>';
  $('#completados').innerHTML = r.completados.length
    ? r.completados.map(cursoHtml).join('')
    : '<p class="vacio">Aún no hay cursos completados.</p>';
}

// ---------- Catálogo ----------
async function cargarCatalogo() {
  const estado = $('#filtro-estado').value;
  const cursos = await api('GET', `/api/cursos${estado ? `?status=${estado}` : ''}`);
  cursosPorId = new Map(cursos.map((c) => [c.id, c]));
  $('#lista-catalogo').innerHTML = cursos.length
    ? cursos.map(cursoHtml).join('')
    : '<p class="vacio">Nada por aquí todavía.</p>';
}

$('#form-curso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#msg-curso');
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (body.hours === '') delete body.hours;
  body.progress = body.status === 'completado' ? 100 : Number(body.progress || 0);
  try {
    await api('POST', '/api/cursos', body);
    e.target.reset();
    setMsg(msg, 'Curso guardado', 'ok');
    await cargarCatalogo();
  } catch (err) {
    setMsg(msg, err.message, 'error');
  }
});

$('#filtro-estado').addEventListener('change', () => cargarCatalogo().catch(alertar));

// ---------- Perfil ----------
async function cargarPerfil() {
  const { skills, settings } = await api('GET', '/api/perfil');
  $('#lista-skills').innerHTML = skills.length
    ? skills.map((s) => `
      <div class="item">
        <div class="item-head"><span class="item-title">${esc(s.name)}</span><span class="meta">nivel ${s.level}/5</span></div>
        <div class="acciones">
          <select data-action="nivel-skill" data-name="${esc(s.name)}" aria-label="Nivel de ${esc(s.name)}">
            ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === s.level ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <button class="peligro" data-action="borrar-skill" data-name="${esc(s.name)}">Quitar</button>
        </div>
      </div>`).join('')
    : '<p class="vacio">Aún no registras habilidades.</p>';

  const f = $('#form-settings');
  f.horas_semana.value = settings.horas_semana ?? '';
  f.idioma.value = settings.idioma;
  f.presupuesto.value = settings.presupuesto;
}

$('#form-skill').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { name, level } = Object.fromEntries(new FormData(e.target).entries());
  try {
    await api('PUT', `/api/perfil/skills/${encodeURIComponent(name.trim())}`, { level: Number(level) });
    e.target.reset();
    await cargarPerfil();
  } catch (err) {
    alertar(err);
  }
});

$('#form-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#msg-settings');
  const f = e.target;
  try {
    await api('PUT', '/api/perfil/settings', {
      horas_semana: f.horas_semana.value,
      idioma: f.idioma.value,
      presupuesto: f.presupuesto.value,
    });
    setMsg(msg, 'Preferencias guardadas', 'ok');
  } catch (err) {
    setMsg(msg, err.message, 'error');
  }
});

// ---------- Rutas ----------
function renderGenerar(r) {
  const modulos = r.modulos.map((m) => `
    <div class="modulo">
      <b>${m.orden}. ${esc(m.tema)}</b>
      <span class="meta">${m.horas_estimadas ? `${m.horas_estimadas} h` : ''}</span>
      <p>${esc(m.objetivo)}</p>
      <p class="meta">${m.course_id
        ? `Curso: ${esc(tituloDe(m.course_id))}`
        : `Sin curso en tu catálogo${m.recurso_sugerido ? `: ${esc(m.recurso_sugerido)}` : ''}`}</p>
    </div>`).join('');
  const omitidos = r.temas_omitidos.length
    ? `<h2>Temas omitidos</h2>${r.temas_omitidos.map((t) => `<p class="meta"><b>${esc(t.tema)}</b>: ${esc(t.motivo)}</p>`).join('')}`
    : '';
  return `<div class="card">
    <h2>${esc(r.titulo)}</h2>
    <p>${esc(r.resumen)}</p>
    <p class="meta">${r.semanas_estimadas ? `≈ ${r.semanas_estimadas} semanas · ` : ''}${r.modulos.length} módulos</p>
    ${modulos}${omitidos}
  </div>`;
}

function renderEvaluar(r) {
  const brechas = r.brechas.length
    ? `<h2>Brechas</h2>${r.brechas.map((b) => `
      <div class="modulo">
        <b>${esc(b.tema)}</b>
        <span class="meta">requerido ${b.nivel_requerido ?? '?'} · tuyo ${b.nivel_actual ?? 'no registrado'}</span>
        <p>${esc(b.accion)}</p>
      </div>`).join('')}`
    : '';
  const orden = r.orden_sugerido.length
    ? `<h2>Orden sugerido</h2><ol>${r.orden_sugerido.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`
    : '';
  const recomendados = r.cursos_recomendados.length
    ? `<h2>Cursos recomendados</h2>${r.cursos_recomendados.map((c) => `<p><b>${esc(tituloDe(c.course_id))}</b>: ${esc(c.razon)}</p>`).join('')}`
    : '';
  return `<div class="card">
    <span class="veredicto ${r.veredicto}">${VERDICT_LABEL[r.veredicto]}</span>
    <b> ${r.puntaje}/100</b>
    <p>${esc(r.resumen)}</p>
    ${brechas}${orden}${recomendados}
  </div>`;
}

async function enviarRuta(form, path, campo, msgEl, render) {
  const valor = form[campo].value.trim();
  const boton = form.querySelector('button');
  boton.disabled = true;
  setMsg(msgEl, 'Pensando… esto puede tardar unos segundos');
  try {
    await cargarCursosCache();
    const r = await api('POST', path, { [campo]: valor });
    setMsg(msgEl, '');
    $('#resultado-ruta').innerHTML = render(r);
    await cargarHistorial();
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    boton.disabled = false;
  }
}

$('#form-generar').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarRuta(e.target, '/api/rutas/generar', 'objetivo', $('#msg-ruta'), renderGenerar);
});

$('#form-evaluar').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarRuta(e.target, '/api/rutas/evaluar', 'ruta', $('#msg-ruta'), renderEvaluar);
});

async function cargarHistorial() {
  const rutas = await api('GET', '/api/rutas');
  $('#historial').innerHTML = rutas.length
    ? rutas.map((r) => `
      <div class="item">
        <div class="item-head">
          <span class="item-title">${esc(r.objetivo.length > 80 ? `${r.objetivo.slice(0, 80)}…` : r.objetivo)}</span>
          <span class="meta">${r.tipo === 'generar' ? 'Generada' : 'Evaluada'} · ${new Date(r.created_at).toLocaleDateString('es-EC')}</span>
        </div>
      </div>`).join('')
    : '<p class="vacio">Todavía no generas ni evalúas rutas.</p>';
}

// ---------- Navegación y acciones ----------
const loaders = { dashboard: cargarAvance, catalogo: cargarCatalogo, perfil: cargarPerfil, rutas: cargarHistorial };

function alertar(err) {
  alert(err?.message ?? String(err));
}

function mostrar(tab) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
  loaders[tab]().catch(alertar);
}

async function refrescar() {
  const tab = document.querySelector('nav button.active').dataset.tab;
  await loaders[tab]();
}

document.querySelector('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) mostrar(btn.dataset.tab);
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || el.type === 'range') return;
  const { action, id, name } = el.dataset;
  try {
    if (action === 'borrar') {
      if (!confirm('¿Eliminar este curso?')) return;
      await api('DELETE', `/api/cursos/${id}`);
    } else if (action === 'borrar-skill') {
      await api('DELETE', `/api/perfil/skills/${encodeURIComponent(name)}`);
    } else {
      return;
    }
    await refrescar();
  } catch (err) {
    alertar(err);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const { action, id, name } = el.dataset;
  try {
    if (action === 'estado') {
      const patch = { status: el.value };
      if (el.value === 'completado') patch.progress = 100;
      await api('PATCH', `/api/cursos/${id}`, patch);
    } else if (action === 'progreso') {
      await api('PATCH', `/api/cursos/${id}`, { progress: Number(el.value) });
    } else if (action === 'nivel-skill') {
      await api('PUT', `/api/perfil/skills/${encodeURIComponent(name)}`, { level: Number(el.value) });
    } else {
      return;
    }
    await refrescar();
  } catch (err) {
    alertar(err);
  }
});

mostrar('dashboard');
