// Prompts y validación para generar y evaluar rutas.
// La regla central: el modelo solo puede referenciar cursos por id del catálogo.
// Cualquier id inventado se descarta antes de devolver la respuesta.

const MAX_CATALOGO = 150;

export function compactCatalog(courses) {
  return courses.slice(0, MAX_CATALOGO).map((c) => ({
    id: c.id,
    titulo: c.title,
    proveedor: c.provider,
    fuente: c.source,
    nivel: c.level,
    horas: c.hours,
    temas: c.topics,
    precio: c.price,
  }));
}

export function describePerfil(skills, settings) {
  const lines = skills.length
    ? skills.map((s) => `- ${s.name}: nivel ${s.level}/5`)
    : ['- (no hay habilidades registradas)'];
  return [
    'Habilidades actuales (escala 1 a 5):',
    ...lines,
    `Horas disponibles por semana: ${settings.horas_semana ?? 'no indicado'}`,
    `Idioma preferido de los cursos: ${settings.idioma}`,
    `Presupuesto: ${settings.presupuesto}`,
  ].join('\n');
}

const SYSTEM_BASE = `Eres un asesor de aprendizaje técnico. Trabajas para una persona concreta y respondes siempre en español.
Reglas obligatorias:
1. Usa SOLO los cursos del catálogo proporcionado y referencia cada uno por su "id". Nunca inventes cursos, URLs ni precios.
2. Si ningún curso del catálogo cubre un tema, usa course_id null y describe en recurso_sugerido el tipo de recurso que buscaría.
3. Respeta el nivel actual: no repitas temas dominados (nivel 4 o 5) y no saltes prerrequisitos.
4. Si hay presupuesto "gratis", prioriza cursos con precio "gratis".
5. Responde únicamente con JSON válido que cumpla el esquema pedido, sin texto adicional.`;

export function promptGenerar({ objetivo, catalogo, perfil }) {
  return {
    system: `${SYSTEM_BASE}
Tarea: diseñar una ruta de aprendizaje para el objetivo de la persona, ordenada por prerrequisitos, ajustada a su nivel y a sus horas por semana.
Esquema JSON:
{"titulo": string, "resumen": string, "semanas_estimadas": number|null,
 "modulos": [{"orden": number, "tema": string, "objetivo": string, "horas_estimadas": number, "course_id": number|null, "recurso_sugerido": string|null}],
 "temas_omitidos": [{"tema": string, "motivo": string}]}`,
    user: `${perfil}\n\nObjetivo: ${objetivo}\n\nCatálogo disponible (JSON):\n${JSON.stringify(catalogo)}`,
  };
}

export function promptEvaluar({ ruta, catalogo, perfil }) {
  return {
    system: `${SYSTEM_BASE}
Tarea: evaluar si la ruta que propone la persona encaja con su perfil. Infiere el nivel requerido de cada tema de la ruta (1 a 5) y compáralo con su nivel actual. Si una habilidad no está registrada, nivel_actual es null y cuenta como brecha.
Esquema JSON:
{"veredicto": "encaja" | "encaja_parcialmente" | "no_encaja", "puntaje": number,
 "resumen": string,
 "brechas": [{"tema": string, "nivel_requerido": number, "nivel_actual": number|null, "accion": string}],
 "orden_sugerido": [string],
 "cursos_recomendados": [{"course_id": number, "razon": string}]}
El puntaje va de 0 a 100.`,
    user: `${perfil}\n\nRuta propuesta por la persona:\n${ruta}\n\nCatálogo disponible (JSON):\n${JSON.stringify(catalogo)}`,
  };
}

const VEREDICTOS = ['encaja', 'encaja_parcialmente', 'no_encaja'];
const num = (v, fallback = null) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

// Acepta el id como número o como texto, y solo devuelve ids que existan en el catálogo.
function resolveCourseId(id, validIds) {
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  return validIds.has(n) ? n : null;
}

export function validarGenerar(raw, validIds) {
  const modulos = arr(raw.modulos)
    .map((m, i) => {
      const course_id = resolveCourseId(m.course_id, validIds);
      return {
        orden: num(m.orden, i + 1),
        tema: str(m.tema),
        objetivo: str(m.objetivo),
        horas_estimadas: num(m.horas_estimadas, 0),
        course_id,
        recurso_sugerido: course_id === null ? str(m.recurso_sugerido) || null : null,
      };
    })
    .filter((m) => m.tema)
    .sort((a, b) => a.orden - b.orden);

  return {
    titulo: str(raw.titulo, 'Ruta de aprendizaje'),
    resumen: str(raw.resumen),
    semanas_estimadas: num(raw.semanas_estimadas),
    modulos,
    temas_omitidos: arr(raw.temas_omitidos)
      .map((t) => ({ tema: str(t.tema), motivo: str(t.motivo) }))
      .filter((t) => t.tema),
  };
}

export function validarEvaluar(raw, validIds) {
  const veredicto = VEREDICTOS.includes(raw.veredicto) ? raw.veredicto : 'encaja_parcialmente';
  return {
    veredicto,
    puntaje: Math.max(0, Math.min(100, num(raw.puntaje, 0))),
    resumen: str(raw.resumen),
    brechas: arr(raw.brechas)
      .map((b) => ({
        tema: str(b.tema),
        nivel_requerido: num(b.nivel_requerido),
        nivel_actual: num(b.nivel_actual),
        accion: str(b.accion),
      }))
      .filter((b) => b.tema),
    orden_sugerido: arr(raw.orden_sugerido).map((t) => str(t)).filter(Boolean),
    cursos_recomendados: arr(raw.cursos_recomendados)
      .map((c) => ({ course_id: resolveCourseId(c.course_id, validIds), razon: str(c.razon) }))
      .filter((c) => c.course_id !== null),
  };
}
