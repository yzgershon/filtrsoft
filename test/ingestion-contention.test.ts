import { test } from 'bun:test';
import { isolated } from './isolated.ts';

const fixture = `
  import { Database } from 'bun:sqlite';
  import { db, DB_PATH } from '@/src/db/index.ts';
  import { upsertListingFacts } from '@/src/db/listings.ts';
  import { storeVerdictWithDb } from '@/src/db/verdicts.ts';
  const d=db();
  d.exec('CREATE TABLE contention_marker(value INTEGER); INSERT INTO contention_marker VALUES(0)');
  const peer=new Database(DB_PATH,{readwrite:true});
  peer.exec('PRAGMA busy_timeout=0');
  const facts={source:'offerup',sourceId:'fixture',url:'https://example.test/fixture',
    title:'RTX 4070',description:'Seller description',askingPriceCents:30000,
    location:null,postedAt:null,photoCount:0};
  const at='2026-09-16T00:00:00.000Z';

  // Interleave a REAL second connection immediately after the first read. A
  // deferred transaction lets this commit, leaving a stale WAL snapshot that
  // cannot be upgraded to a writer even with a nonzero busy_timeout.
  function contendAfterRead(pattern){
    const query=d.query.bind(d);
    let attempted=false, blocked=false;
    d.query=(sql,...args)=>{
      const statement=query(sql,...args);
      if(!pattern.test(sql))return statement;
      return {get(...bindings){
        const result=statement.get(...bindings);
        if(!attempted){
          attempted=true;
          try { peer.run('UPDATE contention_marker SET value=value+1'); }
          catch(error){
            assert.equal(error.errno & 255,5,'Only genuine SQLite write contention is expected');
            blocked=true;
          }
        }
        return result;
      }};
    };
    return ()=>{
      d.query=query;
      assert.equal(attempted,true);
      assert.equal(blocked,true,'The collector write must be reserved before reading');
      peer.run('UPDATE contention_marker SET value=value+1');
      assert.equal(peer.query('SELECT value FROM contention_marker').get().value,1,
        'The competing writer must succeed after the collector commits');
    };
  }
`;

test('listing ingestion survives a competing WAL writer without losing price history',()=>{
  isolated(fixture+`
    const first=upsertListingFacts(d,facts,at);
    const finish=contendAfterRead(/SELECT id, asking_price_cents/);
    const updated=upsertListingFacts(d,{...facts,askingPriceCents:25000},'2026-09-16T01:00:00.000Z');
    finish();
    assert.equal(updated.id,first.id);
    assert.deepEqual(d.query('SELECT price_cents FROM listing_prices ORDER BY id').all(),
      [{price_cents:30000},{price_cents:25000}]);
    assert.equal(d.query('SELECT asking_price_cents FROM listings WHERE id=?').get(first.id).asking_price_cents,25000);
    peer.close(); d.close();
  `);
});

test('verdict ingestion survives a competing WAL writer and preserves both answers',()=>{
  isolated(fixture+`
    const listing=upsertListingFacts(d,facts,at);
    const original=storeVerdictWithDb(d,listing.id,'fixture',{call:'INSUFFICIENT_DATA'},at);
    const finish=contendAfterRead(/SELECT id, engine_version/);
    const next=storeVerdictWithDb(d,listing.id,'fixture',{call:'VERIFY'},'2026-09-16T01:00:00.000Z');
    finish();
    assert.equal(next.inserted,true);
    assert.notEqual(next.id,original.id);
    assert.deepEqual(d.query('SELECT call FROM verdicts ORDER BY id').all(),
      [{call:'INSUFFICIENT_DATA'},{call:'VERIFY'}]);
    peer.close(); d.close();
  `);
});

test('nested listing and verdict writes still roll back with the outer transaction',()=>{
  isolated(fixture+`
    assert.throws(()=>d.transaction(()=>{
      const listing=upsertListingFacts(d,facts,at);
      storeVerdictWithDb(d,listing.id,'fixture',{call:'INSUFFICIENT_DATA'},at);
      throw new Error('abort batch');
    })(),/abort batch/);
    for(const table of ['listings','listing_prices','verdicts'])
      assert.equal(d.query('SELECT COUNT(*) n FROM '+table).get().n,0,table);
    assert.equal(d.inTransaction,false);
    peer.run('UPDATE contention_marker SET value=1');
    peer.close(); d.close();
  `);
});
