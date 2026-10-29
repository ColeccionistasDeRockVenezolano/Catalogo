import {writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../src/db/client.js';
import {compilationSeriesSql,compilationAlbumSql} from '../src/api/repositories/compilation-series.js';
const out=process.argv[2];if(!out)throw new Error('Indica salida de staging');
const db=getPool();
try{
 const stats=(await db.query(`SELECT count(*)::int series,sum(n)::int memberships FROM (SELECT s.id,count(sa.id)::int n FROM ingest.series s JOIN ingest.series_albums sa ON sa.series_id=s.id JOIN ingest.catalog_albums a ON a.id=sa.album_id WHERE ${compilationSeriesSql('s')} GROUP BY s.id) q`)).rows[0];
 const violations=(await db.query(`SELECT s.id series_id,a.id album_id,a.title FROM ingest.series s JOIN ingest.series_albums sa ON sa.series_id=s.id JOIN ingest.catalog_albums a ON a.id=sa.album_id WHERE ${compilationSeriesSql('s')} AND NOT ${compilationAlbumSql('a')}`)).rows;
 const catalog=(await db.query(`SELECT count(*)::int total,count(*) FILTER(WHERE ${compilationAlbumSql('a')})::int compilations FROM ingest.catalog_albums a`)).rows[0];
 const journal=(await db.query(`SELECT j.run_id::int,count(*)::int changes FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE r.params->>'action' LIKE 'series:compilados%' GROUP BY j.run_id ORDER BY j.run_id`)).rows;
 if(violations.length)throw new Error('Hay discos sin clasificación de compilado expuestos en una serie');
 const result={verifiedAt:new Date().toISOString(),stats,catalog,violations,journal};writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await closeDb();}
