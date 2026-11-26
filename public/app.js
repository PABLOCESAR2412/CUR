const $ = (sel) => document.querySelector(sel);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');

const STATUS_LABEL = { catalogo: 'Guardado', en_curso: 'En curso', completado: 'Completado' };
const PRICE_LABEL = { gratis: 'Gratis', pago: 'Pago', desconocido: 'Precio desconocido' };
const SOURCE_LABEL = { coursera: 'Coursera', udemy: 'Udemy', telegram: 'Telegram', google: 'Google', otro: 'Otro' };
const SOURCE_ICON = { coursera: 'school', udemy: 'play_lesson', telegram: 'forum', google: 'code' };
const VERDICT_LABEL = { encaja: 'Encaja', encaja_parcialmente: 'Encaja parcialmente', no_encaja: 'No encaja' };
const NIVEL_LABEL = { 1: 'Conoce el concepto', 2: 'Con ayuda', 3: 'Trabaja solo', 4: 'Sólido', 5: 'Experto' };

const numero = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 });
const icono = (nombre) => `<span class="icono" aria-hidden="true">${esc(nombre)}</span>`;

let cursosPorId = new Map();


const acceso = $('#acceso');
const formAcceso = $('#form-acceso');
let apiToken = '';
try { apiToken = localStorage.getItem('cur-api-token') ?? ''; } catch {}

function mostrarAcceso(mensaje, sinConfigurar = false) {
  if (acceso.hidden) {
    $('#curso-dialog').close();
    $('#udemy-dialog').close();
  }
  acceso.hidden = false;
  acceso.parentElement.classList.add('acceso-requerido');
  formAcceso.hidden = sinConfigurar;
  $('#reintentar-acceso').hidden = !sinConfigurar;
  $('#ayuda-acceso').hidden = sinConfigurar;
  setMsg($('#msg-acceso'), mensaje, 'error');
}

function cerrarAcceso() {
  acceso.hidden = true;
  acceso.parentElement.classList.remove('acceso-requerido');
}

async function api(method, path, body, comprobandoToken) {
  const token = comprobandoToken ?? apiToken;
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    const mensaje = token ? 'La clave de acceso es incorrecta o cambió.' : 'Ingresa tu clave de acceso a CUR.';
    if (comprobandoToken === undefined && token === apiToken) {
      apiToken = '';
      try { localStorage.removeItem('cur-api-token'); } catch {}
      mostrarAcceso(token ? mensaje : '');
    }
    throw new Error(mensaje);
  }

  if (res.status === 503 && data.code === 'CUR_API_TOKEN_MISSING') {
    mostrarAcceso('Falta configurar API_TOKEN en los secretos de este Worker de Cloudflare.', true);
  }
  if (!res.ok) throw new Error(data.error ?? 'Error ' + res.status);
  return data;
}

formAcceso.addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = formAcceso.querySelector('button');
  const nuevoToken = formAcceso.elements.token.value.trim();
  if (!nuevoToken || boton.disabled) return;
  boton.disabled = true;
  setMsg($('#msg-acceso'), 'Validando…');
  try {
    await api('GET', '/api/resumen', undefined, nuevoToken);
    apiToken = nuevoToken;
    let guardado = false;
    try {
      localStorage.setItem('cur-api-token', apiToken);
      guardado = true;
    } catch {}
    formAcceso.reset();
    cerrarAcceso();
    await refrescar();
    if (!guardado) setMsg($('#msg-carga'), 'El navegador solo permite conservar la clave con esta pestaña abierta.');
  } catch (err) {
    if (acceso.hidden) avisarCarga(err);
    else if (!formAcceso.hidden) setMsg($('#msg-acceso'), err.message, 'error');
  } finally {
    boton.disabled = false;
  }
});

$('#reintentar-acceso').addEventListener('click', async () => {
  cerrarAcceso();
  await refrescar().catch(avisarCarga);
});

function setMsg(el, text, kind = '') {
  el.textContent = text;
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

const tituloDe = (id) => cursosPorId.get(Number(id))?.title ?? `Curso #${id}`;

async function cargarCursosCache() {
  const cursos = await api('GET', '/api/cursos');
  cursosPorId = new Map(cursos.map((c) => [c.id, c]));
  return cursos;
}

// ---------- Controles segmentados ----------
// Un contenedor .seg con un <input type="hidden"> guarda el valor elegido.
function setSegmento(seg, valor) {
  if (!seg) return;
  const campo = seg.querySelector('input[type="hidden"]');
  if (campo) campo.value = valor;
  seg.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.valor === valor));
  });
}

function resetearSegmentos(form) {
  form.querySelectorAll('.seg[data-campo]').forEach((seg) => setSegmento(seg, seg.dataset.default ?? ''));
}

// ---------- Tarjeta de curso (avance y catálogo) ----------
function cursoHtml(c) {
  const proveedor = c.provider || SOURCE_LABEL[c.source] || c.source;
  const horas = c.hours == null ? '' : `${numero.format(c.hours)} h`;
  const detalles = [c.level, horas].filter(Boolean).map(esc).join(' · ');
  const chips = c.topics.map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const estados = Object.entries(STATUS_LABEL).map(([valor, etiqueta]) => `
    <button type="button" data-action="estado" data-id="${c.id}" data-valor="${valor}" aria-pressed="${valor === c.status}">${etiqueta}</button>`).join('');

  return `
  <article class="item item-curso" data-estado="${esc(c.status)}">
    <div class="curso-portada">${icono(SOURCE_ICON[c.source] ?? 'menu_book')}</div>
    <div class="curso-cuerpo">
      <div class="item-head">
        <div>
          ${proveedor ? `<p class="meta">${esc(proveedor)}</p>` : ''}
          <h3 class="item-title">${esc(c.title)}</h3>
          ${detalles ? `<p class="meta">${detalles}</p>` : ''}
        </div>
        <span class="chip curso-estado">${esc(STATUS_LABEL[c.status])}</span>
      </div>
      <div class="chips">
        <span class="chip${c.price === 'gratis' ? ' primario' : ''}">${esc(PRICE_LABEL[c.price])}</span>
        ${c.source === 'telegram' ? '<span class="chip">Telegram</span>' : ''}
        ${chips}
      </div>
      <div class="curso-progreso">
        <div class="progreso-cabecera"><span class="meta">Progreso</span><span class="porcentaje">${c.progress}%</span></div>
        <div class="barra" role="progressbar" aria-label="Avance" aria-valuenow="${c.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${c.progress}%"></span></div>
      </div>
      ${c.status === 'en_curso' ? `<input type="range" min="0" max="100" step="5" value="${c.progress}" data-action="progreso" data-id="${c.id}" aria-label="Modificar avance de ${esc(c.title)}">` : ''}
      <div class="acciones">
        <div class="seg" role="group" aria-label="Estado de ${esc(c.title)}">${estados}</div>
        ${c.url ? `<a class="enlace" href="${safeUrl(c.url)}" target="_blank" rel="noopener">Abrir ${icono('open_in_new')}</a>` : ''}
        <button type="button" class="secundario" data-action="editar" data-id="${c.id}">Editar</button>
        <button type="button" class="peligro" data-action="borrar" data-id="${c.id}">Eliminar</button>
      </div>
    </div>
  </article>`;
}

// ---------- Avance ----------
async function cargarAvance() {
  const r = await api('GET', '/api/resumen');
  cursosPorId = new Map([...r.en_curso, ...r.completados].map((c) => [c.id, c]));
  const progresoMedio = r.en_curso.length
    ? r.en_curso.reduce((total, curso) => total + curso.progress, 0) / r.en_curso.length
    : null;
  const cursosConHoras = r.completados.filter((curso) => curso.hours != null);
  const horasCompletados = cursosConHoras.reduce((total, curso) => total + curso.hours, 0);

  $('#totales').innerHTML = [
    ['Cursos guardados', r.totales.catalogo, 'bookmark', ''],
    ['En curso', r.totales.en_curso, 'play_circle', progresoMedio === null ? '' : `${numero.format(progresoMedio)}% de avance promedio`],
    ['Completados', r.totales.completado, 'verified', cursosConHoras.length ? `${numero.format(horasCompletados)} h registradas en estos cursos` : ''],
  ].map(([etiqueta, cantidad, simbolo, detalle]) => `
    <div class="total">
      <span class="total-titulo">${etiqueta}</span>
      <span class="total-icono">${icono(simbolo)}</span>
      <b>${cantidad}</b>
      ${detalle ? `<span class="meta">${detalle}</span>` : ''}
    </div>`).join('');

  const conteoActivos = $('#conteo-activos');
  const conteoCompletados = $('#conteo-completados');
  if (conteoActivos) conteoActivos.textContent = `${r.totales.en_curso} ${r.totales.en_curso === 1 ? 'curso activo' : 'cursos activos'}`;
  if (conteoCompletados) conteoCompletados.textContent = `${r.totales.completado} en total`;
  $('#en-curso').innerHTML = r.en_curso.length
    ? r.en_curso.map(cursoHtml).join('')
    : '<p class="vacio">No tienes cursos en curso. Agrega uno desde Catálogo.</p>';
  $('#completados').innerHTML = r.completados.length
    ? r.completados.map(cursoHtml).join('')
    : '<p class="vacio">Aún no hay cursos completados.</p>';
}

// ---------- Catálogo ----------
async function cargarCatalogo() {
  const estado = $('#filtro-estado input').value;
  const cursos = await api('GET', `/api/cursos${estado ? `?status=${encodeURIComponent(estado)}` : ''}`);
  cursosPorId = new Map(cursos.map((c) => [c.id, c]));
  $('#lista-catalogo').innerHTML = cursos.length
    ? cursos.map(cursoHtml).join('')
    : '<p class="vacio">Nada por aquí todavía.</p>';
}

const dialogCurso = $('#curso-dialog');
const msgCurso = $('#msg-curso');
const msgCatalogo = $('#msg-catalogo');
const cerrarCurso = $('#cerrar-curso');

const formCurso = $('#form-curso');
let cursoEditado = null;

function abrirCurso(curso = null) {
  cursoEditado = curso;
  formCurso.reset();
  resetearSegmentos(formCurso);
  $('#curso-dialog-titulo').textContent = curso ? 'Editar curso' : 'Agregar curso';
  if (curso) {
    for (const campo of ['title', 'provider', 'source', 'url', 'level', 'hours', 'progress']) {
      formCurso.elements[campo].value = curso[campo] ?? '';
    }
    formCurso.elements.topics.value = curso.topics.join(', ');
    for (const campo of ['price', 'status']) {
      setSegmento(formCurso.querySelector('[data-campo="' + campo + '"]'), curso[campo]);
    }
  }
  setMsg(msgCurso, '');
  setMsg(msgCatalogo, '');
  dialogCurso.showModal();
}

$('#abrir-curso').addEventListener('click', () => abrirCurso());

cerrarCurso.addEventListener('click', () => dialogCurso.close());
dialogCurso.addEventListener('cancel', (event) => {
  if (cerrarCurso.disabled) event.preventDefault();
});

formCurso.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submit = form.querySelector('button[type="submit"]');
  if (submit.disabled) return;
  const body = Object.fromEntries(new FormData(form).entries());
  if (!cursoEditado) {
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
  }
  body.progress = body.status === 'completado' ? 100 : Number(body.progress || 0);
  submit.disabled = true;
  cerrarCurso.disabled = true;
  setMsg(msgCurso, 'Guardando…');
  try {
    if (cursoEditado) await api('PATCH', '/api/cursos/' + cursoEditado.id, body);
    else await api('POST', '/api/cursos', body);
  } catch (err) {
    setMsg(msgCurso, err.message, 'error');
    return;
  } finally {
    submit.disabled = false;
    cerrarCurso.disabled = false;
  }

  form.reset();
  resetearSegmentos(form);
  dialogCurso.close();
  setMsg(msgCatalogo, 'Curso guardado', 'ok');
  refrescar().catch(avisarCarga);
});

const udemyDialog = $('#udemy-dialog');
const udemyForm = $('#form-udemy');
const cerrarUdemy = $('#cerrar-udemy');
$('#abrir-udemy').addEventListener('click', () => {
  udemyForm.reset();
  setMsg($('#msg-udemy'), '');
  udemyDialog.showModal();
});
cerrarUdemy.addEventListener('click', () => udemyDialog.close());
udemyDialog.addEventListener('cancel', (e) => {
  if (cerrarUdemy.disabled) e.preventDefault();
});
udemyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = udemyForm.querySelector('button[type="submit"]');
  if (boton.disabled) return;
  boton.disabled = cerrarUdemy.disabled = true;
  setMsg($('#msg-udemy'), 'Importando…');
  try {
    const { creado } = await api('POST', '/api/cursos/importar-udemy', Object.fromEntries(new FormData(udemyForm)));
    udemyDialog.close();
    setSegmento($('#filtro-estado'), '');
    setMsg(msgCatalogo, creado ? 'Curso guardado. Verifica el precio en Udemy.' : 'El curso ya está en tu catálogo.', 'ok');
    await cargarCatalogo().catch(avisarCarga);
  } catch (err) {
    setMsg($('#msg-udemy'), err.message, 'error');
  } finally {
    boton.disabled = cerrarUdemy.disabled = false;
  }
});

// ---------- Perfil ----------
function skillHtml(s) {
  const niveles = [1, 2, 3, 4, 5].map((n) => `
          <button type="button" data-action="nivel-skill" data-name="${esc(s.name)}" data-valor="${n}" aria-pressed="${n === s.level}">${n}</button>`).join('');
  return `
      <div class="item item-skill">
        <div class="item-head">
          <div>
            <h3 class="item-title">${esc(s.name)}</h3>
            <p class="meta">${NIVEL_LABEL[s.level] ?? ''}</p>
          </div>
          <span class="chip">Nivel ${esc(s.level)}</span>
        </div>
        <div class="acciones">
          <div class="seg" role="group" aria-label="Nivel de ${esc(s.name)}">${niveles}
          </div>
          <button class="peligro" data-action="borrar-skill" data-name="${esc(s.name)}">Quitar</button>
        </div>
      </div>`;
}

async function cargarPerfil() {
  const { skills, settings } = await api('GET', '/api/perfil');
  $('#lista-skills').innerHTML = skills.length
    ? skills.map(skillHtml).join('')
    : '<p class="vacio">Aún no registras habilidades.</p>';

  const f = $('#form-settings');
  f.horas_semana.value = settings.horas_semana ?? '';
  f.idioma.value = settings.idioma;
  setSegmento(f.querySelector('[data-campo="presupuesto"]'), settings.presupuesto);
}

$('#form-skill').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const { name, level } = Object.fromEntries(new FormData(form).entries());
  try {
    await api('PUT', `/api/perfil/skills/${encodeURIComponent(name.trim())}`, { level: Number(level) });
    form.reset();
    resetearSegmentos(form);
    await cargarPerfil();
  } catch (err) {
    avisarCarga(err);
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
      <span class="modulo-numero">${esc(m.orden)}</span>
      <div class="modulo-cuerpo">
        <div class="modulo-head">
          <b>${esc(m.tema)}</b>
          ${m.horas_estimadas ? `<span class="meta">${numero.format(m.horas_estimadas)} h</span>` : ''}
        </div>
        <p>${esc(m.objetivo)}</p>
        <p class="meta">${m.course_id
          ? `Curso: ${esc(tituloDe(m.course_id))}`
          : `Sin curso en tu catálogo${m.recurso_sugerido ? `: ${esc(m.recurso_sugerido)}` : ''}`}</p>
      </div>
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
        <p class="meta">requerido ${b.nivel_requerido ?? '?'} · tuyo ${b.nivel_actual ?? 'no registrado'}</p>
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
    <div class="veredicto-fila">
      <span class="veredicto ${r.veredicto}">${VERDICT_LABEL[r.veredicto]}</span>
      <span class="puntaje">${r.puntaje}<small>/100</small></span>
    </div>
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
  const [rutas] = await Promise.all([api('GET', '/api/rutas'), cargarCursosCache()]);
  $('#historial').innerHTML = rutas.length
    ? rutas.map((r) => `
      <details class="item item-historial">
        <summary class="item-head">
          ${icono(r.tipo === 'generar' ? 'account_tree' : 'troubleshoot')}
          <span class="historial-info">
            <span class="item-title">${esc(r.resultado.titulo || r.objetivo)}</span>
            <span class="meta">${esc(new Date(r.created_at).toLocaleDateString('es-EC'))}</span>
          </span>
          <span class="chip">${r.tipo === 'generar' ? 'Generada' : 'Evaluada'}</span>
          ${icono('chevron_right')}
        </summary>
        ${(r.tipo === 'generar' ? renderGenerar : renderEvaluar)(r.resultado)}
      </details>`).join('')
    : '<p class="vacio">Todavía no generas ni evalúas rutas.</p>';
}

// ---------- Tema claro / oscuro ----------
// El tema elegido se guarda en el navegador; sin elección, sigue al sistema.
function temaEfectivo() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function actualizarIconoTema() {
  const oscuro = temaEfectivo() === 'dark';
  const boton = $('#tema');
  const etiqueta = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  boton.querySelector('[data-tema-icono]').textContent = oscuro ? 'light_mode' : 'dark_mode';
  $('#tema-texto').textContent = oscuro ? 'Modo claro' : 'Modo oscuro';
  boton.setAttribute('aria-label', etiqueta);
  boton.title = etiqueta;
}

$('#tema').addEventListener('click', () => {
  const nuevo = temaEfectivo() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nuevo;
  try {
    localStorage.setItem('cur-tema', nuevo);
  } catch {
    /* sin almacenamiento: el cambio dura solo esta visita */
  }
  actualizarIconoTema();
});

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', actualizarIconoTema);

// ---------- Navegación y acciones ----------
const loaders = { dashboard: cargarAvance, catalogo: cargarCatalogo, perfil: cargarPerfil, rutas: cargarHistorial };

function avisarCarga(err) {
  if (acceso.hidden) setMsg($('#msg-carga'), err.message, 'error');
}

function mostrar(tab) {
  document.querySelectorAll('button[data-tab]').forEach((boton) => {
    const activo = boton.dataset.tab === tab;
    boton.classList.toggle('active', activo);
    if (activo) boton.setAttribute('aria-current', 'page');
    else boton.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
  setMsg($('#msg-carga'), '');
  if (acceso.hidden) loaders[tab]().catch(avisarCarga);
}

async function refrescar() {
  const tab = document.querySelector('button[data-tab].active').dataset.tab;
  await loaders[tab]();
}

document.querySelector('.nav-principal').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) mostrar(btn.dataset.tab);
});

document.addEventListener('click', async (e) => {
  // Controles segmentados de formularios y del filtro del catálogo
  const opcion = e.target.closest('.seg[data-campo] button');
  if (opcion) {
    const seg = opcion.parentElement;
    setSegmento(seg, opcion.dataset.valor);
    if (seg.id === 'filtro-estado') cargarCatalogo().catch(avisarCarga);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, name, valor } = el.dataset;
  if (el.getAttribute('aria-pressed') === 'true') return; // ya estaba seleccionado

  if (action === 'editar') {
    const curso = cursosPorId.get(Number(id));
    if (curso) abrirCurso(curso);
    return;
  }

  try {
    if (action === 'estado') {
      const patch = { status: valor };
      if (valor === 'completado') patch.progress = 100;
      await api('PATCH', `/api/cursos/${id}`, patch);
    } else if (action === 'nivel-skill') {
      await api('PUT', `/api/perfil/skills/${encodeURIComponent(name)}`, { level: Number(valor) });
    } else if (action === 'borrar') {
      if (!confirm('¿Eliminar este curso?')) return;
      await api('DELETE', `/api/cursos/${id}`);
    } else if (action === 'borrar-skill') {
      await api('DELETE', `/api/perfil/skills/${encodeURIComponent(name)}`);
    } else {
      return; // p. ej. el control de avance: se maneja en "change"
    }
    await refrescar();
  } catch (err) {
    avisarCarga(err);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.action !== 'progreso') return;
  try {
    await api('PATCH', `/api/cursos/${el.dataset.id}`, { progress: Number(el.value) });
    await refrescar();
  } catch (err) {
    avisarCarga(err);
  }
});

actualizarIconoTema();
mostrar('dashboard');
