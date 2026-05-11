const path = require('path')
const Database = require('better-sqlite3')
const { SQL_SCHEMA } = require('./sqlite-schema')

const dbPath = path.join(__dirname, '..', '..', 'guga.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const statements = SQL_SCHEMA.split(';').filter(s => s.trim().length > 10)
for (const statement of statements) {
  if (statement.trim()) {
    db.exec(statement + ';')
  }
}

function toSQLite(sql) {
  let result = sql
    .replace(/\$([0-9]+)/g, '?$1')
    .replace(/gen_random_uuid\(\)/g, "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))")

  // Handle INTERVAL additions/subtractions with NOW() or CURRENT_DATE BEFORE replacing NOW()
  result = result.replace(/(?:NOW\(\)|CURRENT_DATE)\s*\+\s*INTERVAL '([^']+)'/gi, "datetime('now', '+$1')")
  result = result.replace(/(?:NOW\(\)|CURRENT_DATE)\s*-\s*INTERVAL '([^']+)'/gi, "datetime('now', '-$1')")

  // Now replace NOW() and other date functions
  result = result.replace(/NOW\(\)/g, "datetime('now')")
  result = result.replace(/CURRENT_DATE/g, "date('now')")
  result = result.replace(/CURRENT_TIMESTAMP/g, "datetime('now')")
  result = result.replace(/ROUND\(/g, 'ROUND(')
  result = result.replace(/NULLIF\(([^,]+), 0\)/g, 'CASE WHEN $1 = 0 THEN NULL ELSE $1 END')

  // Handle EXTRACT with any expression (not just NOW())
  result = result.replace(/EXTRACT\(MONTH FROM ([^)]+)\)/g, "strftime('%m', $1)")
  result = result.replace(/EXTRACT\(YEAR FROM ([^)]+)\)/g, "strftime('%Y', $1)")

  // Handle EXTRACT(DAY FROM date1 - date2) for date differences like deadline - NOW()
  result = result.replace(/EXTRACT\(DAY FROM (\w+\.\w+)\s*-\s*NOW\(\)\)/g, "(CAST(julianday($1) - julianday('now') AS INTEGER))")

  // Handle EXTRACT(DAY FROM ...) for other date expressions
  result = result.replace(/EXTRACT\(DAY FROM ([^)]+)\)/g, "(CAST(julianday($1) AS INTEGER))")

  // Convert to Malaysia time (UTC+8)
  result = result.replace(/datetime\('now'\)/g, "datetime('now', '+8 hours')")
  result = result.replace(/date\('now'\)/g, "date('now', '+8 hours')")

  return result
}

function sanitize(v) { return v === undefined ? null : v }

function toBindings(params) {
  const obj = {}
  for (let i = 0; i < params.length; i++) {
    obj[i + 1] = sanitize(params[i])
  }
  return obj
}

function query(sql, params = []) {
  const converted = toSQLite(sql)
  if (process.env.NODE_ENV === 'development') {
    console.log('SQL:', converted, 'Params:', params)
  }
  const trimmed = converted.trim().toUpperCase()

  if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
    const stmt = db.prepare(converted)
    const rows = stmt.all(toBindings(params))
    return Promise.resolve({ rows, rowCount: rows.length })
  }

  if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE')) {
    const stmt = db.prepare(converted)
    if (converted.toUpperCase().includes('RETURNING')) {
      const rows = stmt.all(toBindings(params))
      return Promise.resolve({ rows, rowCount: rows.length })
    }
    const info = stmt.run(toBindings(params))
    return Promise.resolve({
      rows: [],
      rowCount: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    })
  }

  const stmt = db.prepare(converted)
  const info = stmt.run(toBindings(params))
  return Promise.resolve({ rows: [], rowCount: info.changes })
}

module.exports = {
  query,
  getClient: async () => ({ query, release: () => {} }),
  pool: {
    end: async () => { db.close() },
  },
  toSQLite,
  raw: db,
}
