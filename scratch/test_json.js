const db = require('better-sqlite3')(':memory:');
db.exec("CREATE TABLE t (id INT, context TEXT)");
db.exec(`INSERT INTO t VALUES (1, '{"milestone": "500"}')`);
db.exec(`INSERT INTO t VALUES (2, '{"milestone": "1000"}')`);

try {
  const rows = db.prepare("SELECT * FROM t WHERE context->>'milestone' = ?").all('500');
  console.log('->> operator works:', rows);
} catch(e) {
  console.error('->> error:', e.message);
}

try {
  const rows = db.prepare("SELECT * FROM t WHERE json_extract(context, '$.milestone') = ?").all('500');
  console.log('json_extract works:', rows);
} catch(e) {
  console.error('json_extract error:', e.message);
}
