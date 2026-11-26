import { DatabaseSync } from 'node:sqlite';

const now = () => new Date().toISOString();

export const STATUSES = ['catalogo', 'en_curso', 'completado'];
export const PRICES = ['gratis', 'pago', 'desconocido'];

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      provider TEXT,
      source TEXT,
      url TEXT,
      level TEXT,
      hours REAL,
      topics TEXT NOT NULL DEFAULT '[]',
      price TEXT NOT NULL DEFAULT 'desconocido' CHECK (price IN ('gratis','pago','desconocido')),
      status TEXT NOT NULL DEFAULT 'catalogo' CHECK (status IN ('catalogo','en_curso','completado')),
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rutas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK (tipo IN ('generar','evaluar')),
      objetivo TEXT NOT NULL,
      resultado TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const parseCourse = (row) => row && { ...row, topics: JSON.parse(row.topics) };

  return {
    raw: db,

    listCourses({ status } = {}) {
      const rows = status
        ? db.prepare('SELECT * FROM courses WHERE status = ? ORDER BY updated_at DESC').all(status)
        : db.prepare('SELECT * FROM courses ORDER BY updated_at DESC').all();
      return rows.map(parseCourse);
    },

    getCourse(id) {
      return parseCourse(db.prepare('SELECT * FROM courses WHERE id = ?').get(id));
    },

    createCourse(data) {
      const t = now();
      const r = db.prepare(`
        INSERT INTO courses (title, provider, source, url, level, hours, topics, price, status, progress, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.title, data.provider ?? null, data.source ?? null, data.url ?? null,
        data.level ?? null, data.hours ?? null, JSON.stringify(data.topics ?? []),
        data.price ?? 'desconocido', data.status ?? 'catalogo', data.progress ?? 0,
        data.notes ?? null, t, t,
      );
      return this.getCourse(Number(r.lastInsertRowid));
    },

    updateCourse(id, patch) {
      const current = this.getCourse(id);
      if (!current) return null;
      const merged = { ...current, ...patch };
      if (merged.status === 'completado') merged.progress = 100;
      db.prepare(`
        UPDATE courses SET title=?, provider=?, source=?, url=?, level=?, hours=?, topics=?,
          price=?, status=?, progress=?, notes=?, updated_at=? WHERE id=?
      `).run(
        merged.title, merged.provider, merged.source, merged.url, merged.level, merged.hours,
        JSON.stringify(merged.topics ?? []), merged.price, merged.status, merged.progress,
        merged.notes, now(), id,
      );
      return this.getCourse(id);
    },

    deleteCourse(id) {
      return db.prepare('DELETE FROM courses WHERE id = ?').run(id).changes > 0;
    },

    listSkills() {
      return db.prepare('SELECT name, level FROM skills ORDER BY name').all();
    },

    setSkill(name, level) {
      db.prepare(`
        INSERT INTO skills (name, level, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at
      `).run(name, level, now());
    },

    deleteSkill(name) {
      return db.prepare('DELETE FROM skills WHERE name = ?').run(name).changes > 0;
    },

    getSettings() {
      const out = { horas_semana: null, idioma: 'es', presupuesto: 'cualquiera' };
      for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
        out[key] = value;
      }
      return out;
    },

    setSetting(key, value) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, String(value));
    },

    saveRuta({ tipo, objetivo, resultado }) {
      const r = db.prepare(
        'INSERT INTO rutas (tipo, objetivo, resultado, created_at) VALUES (?, ?, ?, ?)',
      ).run(tipo, objetivo, JSON.stringify(resultado), now());
      return Number(r.lastInsertRowid);
    },

    listRutas(limit = 20) {
      return db.prepare('SELECT * FROM rutas ORDER BY id DESC LIMIT ?').all(limit)
        .map((r) => ({ ...r, resultado: JSON.parse(r.resultado) }));
    },

    resumen() {
      const counts = db.prepare(
        'SELECT status, COUNT(*) AS n FROM courses GROUP BY status',
      ).all();
      const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const { status, n } of counts) byStatus[status] = n;
      return {
        totales: byStatus,
        en_curso: this.listCourses({ status: 'en_curso' }),
        completados: this.listCourses({ status: 'completado' }),
      };
    },
  };
}
