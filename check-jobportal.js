const { Client } = require('pg');

async function test() {
  const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5432/job-portal' });
  await client.connect();
  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log('Tables in job-portal:', res.rows.map(r => r.table_name));

  for (const t of res.rows) {
    if (t.table_name.toLowerCase().includes('app') || t.table_name.toLowerCase().includes('user') || t.table_name.toLowerCase().includes('cand')) {
      const rows = await client.query(`SELECT * FROM "${t.table_name}" LIMIT 5`);
      console.log(`\n--- ${t.table_name} (${rows.rows.length} rows) ---`);
      console.log(JSON.stringify(rows.rows, null, 2));
    }
  }

  await client.end();
}

test().catch(console.error);
