import {test} from "bun:test";
import {isolated} from "./isolated.ts";

const fixture=`
  import {db} from '@/src/db/index.ts';
  import {ensureAlertTables,runAlerts} from '@/src/api/alerts.ts';
  import webpush from '@/node_modules/web-push/src/index.js';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {storeVerdict} from '@/src/db/verdicts.ts';
  const d=db(),at=new Date().toISOString();
  ensureAlertTables();
  d.run("INSERT INTO users(id,email,created_at,last_seen_at) VALUES(1,'audit@example.invalid',?,?)",[at,at]);
  d.run("INSERT INTO account_devices(device_ref,user_id,created_at) VALUES('fixture_ref',1,?)",[at]);
  d.run("INSERT INTO push_subs(id,endpoint,p256dh,auth,created_at,user_id) VALUES(1,'https://audit.invalid/push','synthetic','synthetic',?,1)",[at]);
  ensureAlertTables();d.run("UPDATE saved_searches SET created_at='2000-01-01T00:00:00.000Z'");
  let serial=0;
  const listing=(call,title='Audit listing')=>{
    const id=upsertListingFacts(d,{source:'audit',sourceId:String(++serial),url:'https://audit.invalid/'+serial,title,description:'',askingPriceCents:40000,location:null,postedAt:null,photoCount:0}).id;
    storeVerdict(id,'0.3.34',{call});return id;
  };
`;

test("forty newer nonmatches do not starve an older eligible alert; personal risk labels suppress delivery",()=>isolated(fixture+`
  const wanted=listing('BUY');const excluded=listing('BUY');
  d.run("INSERT INTO verdict_overrides(device_ref,listing_id,call,created_at) VALUES('fixture_ref',?,'RISK',?)",[excluded,at]);
  for(let i=0;i<40;i++)listing('PASS');
  const sent=[];webpush.sendNotification=async(sub,payload)=>{sent.push(JSON.parse(payload));return {};};
  assert.equal(await runAlerts(),1);assert.equal(sent[0].url,'/c/'+wanted);
  assert.equal(await runAlerts(),0);assert.equal(sent.length,1);
`));

test("transient delivery failure stays retryable and only successful delivery is acknowledged",()=>isolated(fixture+`
  const id=listing('BUY');let attempts=0;console.error=()=>{};
  webpush.sendNotification=async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('synthetic temporary failure'),{statusCode:503});return {};};
  assert.equal(await runAlerts(),0);assert.equal(d.query('SELECT COUNT(*) n FROM alert_sent').get().n,0);
  assert.equal(d.query('SELECT status FROM alert_deliveries').get().status,'retry');
  assert.equal(await runAlerts(),0);assert.equal(attempts,1);
  d.run("UPDATE alert_deliveries SET next_attempt_at='2000-01-01T00:00:00.000Z'");
  assert.equal(await runAlerts(),1);assert.equal(attempts,2);
  assert.equal(d.query('SELECT COUNT(*) n FROM alert_sent WHERE listing_id=?').get(id).n,1);
  assert.equal(await runAlerts(),0);assert.equal(attempts,2);
`));

test("an in-flight delivery lease prevents concurrent sends and an expired lease can recover",()=>isolated(fixture+`
  listing('BUY');let release;let attempts=0;
  const pending=new Promise(resolve=>{release=resolve;});
  webpush.sendNotification=async()=>{attempts++;await pending;return {};};
  const first=runAlerts();
  await Promise.resolve();assert.equal(attempts,1);
  assert.equal(await runAlerts(),0);assert.equal(attempts,1);
  release();assert.equal(await first,1);
  const recover=listing('BUY');const searchId=d.query('SELECT id FROM saved_searches LIMIT 1').get().id;
  d.run("INSERT INTO alert_deliveries(search_id,listing_id,status,attempts,next_attempt_at,lease_until,updated_at) VALUES(?,?,'sending',1,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:01.000Z',?)",[searchId,recover,at]);
  assert.equal(await runAlerts(),1);assert.equal(attempts,2);
`));

test("permanent subscription failure is terminal without falsely recording delivery",()=>isolated(fixture+`
  listing('BUY');webpush.sendNotification=async()=>{throw Object.assign(new Error('gone'),{statusCode:410});};
  assert.equal(await runAlerts(),0);
  assert.equal(d.query('SELECT status FROM alert_deliveries').get().status,'failed');
  assert.equal(d.query('SELECT COUNT(*) n FROM alert_sent').get().n,0);
  assert.equal(await runAlerts(),0);
`));

test("job expiration handles same-day, midnight and exact TTL boundaries chronologically",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {sweepStaleJobs,JOB_TTL_MIN,RUNNING_TIMEOUT_MIN} from '@/src/api/jobs.ts';
  const d=db();
  for(const time of ['2026-09-07T03:00:00.000Z','2026-09-08T00:10:00.000Z']){
    const at=Date.parse(time);d.run('DELETE FROM crawl_jobs');
    for(const [id,status,age] of [[1,'queued',JOB_TTL_MIN*60000+1],[2,'queued',JOB_TTL_MIN*60000],[3,'running',RUNNING_TIMEOUT_MIN*60000+1],[4,'running',RUNNING_TIMEOUT_MIN*60000]]){
      const created=new Date(at-age).toISOString();d.run('INSERT INTO crawl_jobs(id,status,sources,created_at,started_at) VALUES(?,?,?, ?,?)',[id,status,'[]',created,status==='running'?created:null]);
    }
    sweepStaleJobs(at);
    assert.deepEqual(d.query('SELECT status FROM crawl_jobs ORDER BY id').all().map(r=>r.status),['expired','queued','failed','running']);
  }d.close();
`));

test('alerts require fresh seller evidence and refuse unknown or sold availability',()=>isolated(fixture+`
  import {recordProbe} from '@/src/db/probes.ts';
  const id=listing('BUY');d.run("UPDATE listings SET source='mercari' WHERE id=?",[id]);
  let attempts=0;webpush.sendNotification=async()=>{attempts++;return {};};
  assert.equal(await runAlerts(),0);
  d.run('UPDATE listings SET description=?,updated_at=? WHERE id=?',['Tested RTX 4090 in working condition',at,id]);
  recordProbe(id,'unknown');assert.equal(await runAlerts(),0);
  recordProbe(id,'gone');assert.equal(await runAlerts(),0);
  recordProbe(id,'alive',Date.now()-7*3600000);assert.equal(await runAlerts(),0);
  recordProbe(id,'alive');assert.equal(await runAlerts(),1);assert.equal(attempts,1);
`));
