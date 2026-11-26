// Capa de datos sobre Cloudflare D1 (SQLite). Recibe el binding `env.DB`.
export const STATUSES = ['catalogo', 'en_curso', 'completado'];
export const PRICES = ['gratis', 'pago', 'desconocido'];

const now = () => new Date().toISOString();
const parseCourse = (row) => row && { ...row, topics: JSON.parse(row.topics) };

export function createDb(d1) {
  const q = (sql, ...args) => d1.prepare(sql).bind(...args);

  const getCourse = async (id) => parseCourse(await q('SELECT * FROM courses WHERE id = ?', id).first());

  return {
    async listCourses({ status } = {}) {
      const stmt = status
        ? q('SELECT * FROM courses WHERE status = ? ORDER BY updated_at DESC', status)
        : d1.prepare('SELECT * FROM courses ORDER BY updated_at DESC');
      const { results } = await stmt.all();
      return results.map(parseCourse);
    },

    getCourse,

    async createCourse(data) {
      const t = now();
      const { meta } = await q(`
        INSERT INTO courses (title, provider, source, url, level, hours, topics, price, status, progress, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        data.title, data.provider ?? null, data.source ?? null, data.url ?? null,
        data.level ?? null, data.hours ?? null, JSON.stringify(data.topics ?? []),
        data.price ?? 'desconocido', data.status ?? 'catalogo', data.progress ?? 0,
        data.notes ?? null, t, t,
      ).run();
      return getCourse(meta.last_row_id);
    },

    async updateCourse(id, patch) {
      const current = await getCourse(id);
      if (!current) return null;
      const merged = { ...current, ...patch };
      if (patch.progress !== undefined && patch.progress < 100 && merged.status === 'completado') {
        merged.status = 'en_curso';
      }
      if (current.status === 'completado' && patch.status && patch.status !== 'completado' && patch.progress === undefined) {
        merged.progress = 0;
      }
      if (merged.status === 'completado') merged.progress = 100;
      await q(`
        UPDATE courses SET title=?, provider=?, source=?, url=?, level=?, hours=?, topics=?,
          price=?, status=?, progress=?, notes=?, updated_at=? WHERE id=?
      `,
        merged.title, merged.provider ?? null, merged.source ?? null, merged.url ?? null,
        merged.level ?? null, merged.hours ?? null, JSON.stringify(merged.topics ?? []),
        merged.price, merged.status, merged.progress, merged.notes ?? null, now(), id,
      ).run();
      return getCourse(id);
    },

    async deleteCourse(id) {
      const { meta } = await q('DELETE FROM courses WHERE id = ?', id).run();
      return meta.changes > 0;
    },

    async listSkills() {
      const { results } = await d1.prepare('SELECT name, level FROM skills ORDER BY name').all();
      return results;
    },

    async setSkill(name, level) {
      await q(`
        INSERT INTO skills (name, level, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at
      `, name, level, now()).run();
    },

    async deleteSkill(name) {
      const { meta } = await q('DELETE FROM skills WHERE name = ?', name).run();
      return meta.changes > 0;
    },

    async getSettings() {
      const out = { horas_semana: null, idioma: 'es', presupuesto: 'cualquiera' };
      const { results } = await d1.prepare('SELECT key, value FROM settings').all();
      for (const { key, value } of results) out[key] = value;
      return out;
    },

    async setSettings(settings) {
      const statements = Object.entries(settings).map(([key, value]) => {
        if (value === null) return q('DELETE FROM settings WHERE key = ?', key);
        return q(`
          INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, key, String(value));
      });
      if (statements.length) await d1.batch(statements);
    },

    async saveRuta({ tipo, objetivo, resultado }) {
      const { meta } = await q(
        'INSERT INTO rutas (tipo, objetivo, resultado, created_at) VALUES (?, ?, ?, ?)',
        tipo, objetivo, JSON.stringify(resultado), now(),
      ).run();
      return meta.last_row_id;
    },

    async listRutas(limit = 20) {
      const { results } = await q('SELECT * FROM rutas ORDER BY id DESC LIMIT ?', limit).all();
      return results.map((r) => ({ ...r, resultado: JSON.parse(r.resultado) }));
    },

    async resumen() {
      const { results } = await d1.prepare('SELECT status, COUNT(*) AS n FROM courses GROUP BY status').all();
      const totales = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const { status, n } of results) totales[status] = n;
      return {
        totales,
        en_curso: await this.listCourses({ status: 'en_curso' }),
        completados: await this.listCourses({ status: 'completado' }),
      };
    },
  };
}
