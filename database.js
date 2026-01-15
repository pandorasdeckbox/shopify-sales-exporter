import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db;

export function initDatabase(dbUrl) {
  // Parse database URL
  if (dbUrl.startsWith('sqlite:')) {
    const dbPath = dbUrl.replace('sqlite:', '');
    const fullPath = join(process.cwd(), dbPath);
    
    // Create directory if it doesn't exist
    const dir = dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(fullPath);
    
    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        shop TEXT NOT NULL,
        access_token TEXT NOT NULL,
        scope TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_shop ON sessions(shop);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    console.log('SQLite database initialized at:', fullPath);
  } else if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
    // PostgreSQL support for production
    console.log('PostgreSQL database will be used via express-session store');
  }

  return db;
}

export function saveSession(session) {
  if (!db) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, shop, access_token, scope, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  stmt.run(
    session.id,
    session.shop,
    session.accessToken,
    session.scope,
    session.expires,
    session.created_at || now,
    now
  );
}

export function getSession(shop) {
  if (!db) {
    console.log('getSession: database not initialized');
    return null;
  }

  console.log('getSession: Looking up session for shop:', shop);
  const stmt = db.prepare('SELECT * FROM sessions WHERE shop = ? LIMIT 1');
  const row = stmt.get(shop);

  console.log('getSession: Found row:', row ? 'YES' : 'NO');
  if (row) {
    console.log('getSession: Row shop value:', row.shop);
  }

  if (!row) return null;

  return {
    id: row.id,
    shop: row.shop,
    accessToken: row.access_token,
    scope: row.scope,
    expires: row.expires_at,
    isOnline: false
  };
}

export function deleteSession(shop) {
  if (!db) return;

  const stmt = db.prepare('DELETE FROM sessions WHERE shop = ?');
  stmt.run(shop);
}

export function getAllSessions() {
  if (!db) return [];

  const stmt = db.prepare('SELECT * FROM sessions');
  const rows = stmt.all();

  return rows.map(row => ({
    id: row.id,
    shop: row.shop,
    accessToken: row.access_token,
    scope: row.scope,
    expires: row.expires_at,
    isOnline: false
  }));
}

export default {
  initDatabase,
  saveSession,
  getSession,
  deleteSession,
  getAllSessions
};
