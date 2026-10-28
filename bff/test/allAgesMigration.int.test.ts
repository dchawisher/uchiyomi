import test from 'node:test';
import assert from 'node:assert/strict';

const dsn = process.env.TEST_DATABASE_URL;
if (dsn) {
  process.env.DATABASE_URL = dsn;
  process.env.JWT_SECRET ||= 'all-ages-migration-test-secret';
  process.env.CONFIG_DIR ||= '/tmp/uchiyomi-all-ages-test';
  process.env.LIBRARY_BACKEND = 'owned';
}

test('retired shelf exceptions migrate once, preserving minimum ages and explicit All ages', { skip: !dsn }, async () => {
  const { migrate } = await import('../src/lib/migrate');
  const { q, pool } = await import('../src/lib/db');
  await migrate();
  const ids = ['s_aa_unrated', 's_aa_rated', 's_aa_scanned', 's_aa_zero'];
  try {
    await q(`INSERT INTO libraries (id,name,path) VALUES ('lib_aa','All ages migration','/all-ages-migration')`);
    for (const [i, id] of ids.entries()) {
      await q(`INSERT INTO lib_series (id,source,title,folder,books_count,library_id,age_rating,latest_mtime,created_at)
        VALUES ($1,'test',$1,$1,1,'lib_aa',$2,1,now())`, [id, i === 2 ? 13 : null]);
      await q(`INSERT INTO series_overrides (series_id,age_rating,adult_exempt) VALUES ($1,$2,true)`, [id, i === 1 ? 18 : i === 3 ? 0 : null]);
    }
    await q(`DELETE FROM schema_migrations WHERE id='hawisher-004-all-ages-rating'`);
    await migrate();
    const rows = await q<{ series_id: string; age_rating: number; adult_exempt: boolean | null }>(
      'SELECT series_id,age_rating,adult_exempt FROM series_overrides WHERE series_id=ANY($1)', [ids]);
    const expected = new Map(ids.map((id, i) => [id, [0, 18, 13, 0][i]]));
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.age_rating, expected.get(row.series_id));
      assert.equal(row.adult_exempt, null);
    }
    await q('UPDATE series_overrides SET age_rating=10 WHERE series_id=$1', [ids[0]]);
    await migrate();
    assert.equal((await q<{ age_rating: number }>('SELECT age_rating FROM series_overrides WHERE series_id=$1', [ids[0]]))[0].age_rating, 10);
  } finally {
    await q('DELETE FROM series_overrides WHERE series_id=ANY($1)', [ids]);
    await q('DELETE FROM lib_series WHERE id=ANY($1)', [ids]);
    await q("DELETE FROM libraries WHERE id='lib_aa'");
    await pool.end();
  }
});
