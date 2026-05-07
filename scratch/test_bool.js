const db = require('better-sqlite3')(':memory:');
db.exec('CREATE TABLE t (id INT, active INTEGER DEFAULT 1)');
db.exec('INSERT INTO t VALUES (1, 1), (2, 0)');

console.log('is_active = true:', db.prepare('SELECT * FROM t WHERE active = true').all());
console.log('is_active = 1:', db.prepare('SELECT * FROM t WHERE active = 1').all());
console.log('is_active = false:', db.prepare('SELECT * FROM t WHERE active = false').all());
