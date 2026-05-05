const { SQL_SCHEMA } = require('./sqlite-schema')
const { raw: db, pool } = require('./connection')

async function migrate() {
  try {
    console.log('Running SQLite migrations...')

    const statements = SQL_SCHEMA.split(';').filter(s => s.trim().length > 10)

    let count = 0
    for (const statement of statements) {
      if (statement.trim()) {
        db.exec(statement + ';')
        count++
      }
    }

    console.log(`  Executed ${count} table/index statements`)
    console.log('All migrations completed successfully.')

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    console.log('  Tables created:', tables.map(t => t.name).join(', '))

    db.close()
  } catch (error) {
    console.error('Migration failed:', error.message)
    process.exit(1)
  }
}

migrate()
