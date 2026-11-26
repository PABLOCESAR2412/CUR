// Adaptador de prueba: expone la misma interfaz que el binding D1 de Workers
// (prepare → bind → all / first / run) sobre SQLite local, para correr las pruebas en Node.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function sqliteD1(migrationFiles = []) {
  const db = new DatabaseSync(':memory:');
  for (const file of migrationFiles) db.exec(readFileSync(file, 'utf8'));

  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const api = {
        bind(...args) {
          params = args;
          return api;
        },
        async all() {
          return { results: stmt.all(...params), success: true, meta: {} };
        },
        async first() {
          return stmt.get(...params) ?? null;
        },
        async run() {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return api;
    },
  };
}
