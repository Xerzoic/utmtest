const { query } = require('../src/database/connection')

async function fix() {
  console.log('Fixing goals...')
  const r1 = await query(
    "UPDATE goals SET id = gen_random_uuid() WHERE id IS NULL OR id = ''"
  )
  console.log('  Goals fixed:', r1.rowCount)

  console.log('Fixing savings_groups...')
  const r2 = await query(
    "UPDATE savings_groups SET id = gen_random_uuid() WHERE id IS NULL OR id = ''"
  )
  console.log('  Groups fixed:', r2.rowCount)

  console.log('Fixing autosave_rules...')
  const r3 = await query(
    "UPDATE autosave_rules SET id = gen_random_uuid() WHERE id IS NULL OR id = ''"
  )
  console.log('  Rules fixed:', r3.rowCount)

  console.log('Fixing group_members...')
  const r4 = await query(
    "UPDATE group_members SET id = gen_random_uuid() WHERE id IS NULL OR id = ''"
  )
  console.log('  Members fixed:', r4.rowCount)

  process.exit(0)
}
fix().catch(e => { console.error(e); process.exit(1) })
