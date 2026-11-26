-- Esquema inicial de CUR (Cloudflare D1 / SQLite)

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
