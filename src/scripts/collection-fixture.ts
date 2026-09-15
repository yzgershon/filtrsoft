/** Disposable local UI fixture. Refuse any existing database. */
import {existsSync} from 'node:fs';
if(!process.env.FILTRSOFT_DB?.includes('collection-fixture-')||existsSync(process.env.FILTRSOFT_DB))throw new Error('A new collection fixture database is required');
process.env.FILTRSOFT_OWNER_REF='fixture-owner';process.env.FILTRSOFT_PUSH_TOKEN='fixture-machine';
const {app}=await import('../api/index.ts');const {db,now}=await import('../db/index.ts');const d=db();
d.run("INSERT INTO users(id,email,name,created_at,last_seen_at) VALUES(1,'fixture@example.invalid','Preview',?,?)",[now(),now()]);
d.run("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES('collection-fixture',1,?,'2099-01-01')",[now()]);
d.run("INSERT INTO account_devices VALUES('fixture-owner',1,?)",[now()]);
const id='00000000-0000-4000-8000-000000000001';
d.run('INSERT INTO collector_nodes VALUES(?,?,?,?,?)',[id,'Gaming desktop','fixture',now(),JSON.stringify({status:'online',jobId:null,pending:{facebook:2},maintenance:{backup:{status:'done',finishedAt:now(),note:'Verified'}}})]);
d.run("INSERT INTO crawl_jobs(id,status,sources,created_at,heartbeat_at) VALUES(1,'done','[]',?,?)",[now(),now()]);
d.run("INSERT INTO crawl_job_stages VALUES(1,'facebook/search-gpu','done',?,?,NULL)",[now(),now()]);
d.run("INSERT INTO crawl_job_stages VALUES(1,'mercari/search-gpu','failed',?,?,'challenge')",[now(),now()]);
Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??3194),fetch:app.fetch});console.log('collection fixture ready');
