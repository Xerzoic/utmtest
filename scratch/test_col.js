const db = require('better-sqlite3')(':memory:');
db.exec('CREATE TABLE t (v INT)');
db.exec('INSERT INTO t VALUES (1), (2), (3)');

console.log('COUNT(*):', db.prepare('SELECT COUNT(*) FROM t').get());
console.log('COALESCE(SUM(v)):', db.prepare('SELECT COALESCE(SUM(v), 0) FROM t').get());
console.log('SUM with alias:', db.prepare('SELECT COALESCE(SUM(v), 0) as total FROM t').get());
