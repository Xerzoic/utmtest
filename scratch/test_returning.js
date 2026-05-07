const db = require('better-sqlite3')(':memory:');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');

// Test RETURNING with .run()
try {
  const info = db.prepare('INSERT INTO t (name) VALUES (?) RETURNING *').run('hello');
  console.log('.run() with RETURNING:', info);
} catch(e) {
  console.error('.run() error:', e.message);
}

// Test RETURNING with .all()
try {
  const rows = db.prepare('INSERT INTO t (name) VALUES (?) RETURNING *').all('world');
  console.log('.all() with RETURNING:', rows);
} catch(e) {
  console.error('.all() error:', e.message);
}
