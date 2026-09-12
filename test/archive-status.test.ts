import {test} from 'bun:test';
import {isolated} from './isolated.ts';

test('archive status invalidates replaced or missing files and reads import acknowledgements freshly',()=>isolated(`
  import {archiveStatus,writeArchive,archiveManifest,importArchive} from '@/src/db/archive.ts';
  import {renameSync,unlinkSync,writeFileSync} from 'node:fs';
  const a={version:2,exportedAt:'2026-09-12T00:00:00.000Z',skus:[],comps:[],retail:[]};a.manifest=archiveManifest(a);
  writeArchive(a,'./archive.gz');
  const first=archiveStatus('./archive.gz');assert.equal(first.present,true);assert.equal(first.imported,false);
  first.comps=999;assert.equal(archiveStatus('./archive.gz').comps,0);
  importArchive(a);assert.equal(archiveStatus('./archive.gz').imported,true);
  const b={...a,exportedAt:'2026-09-13T00:00:00.000Z'};
  writeArchive(b,'./replacement.gz');renameSync('./replacement.gz','./archive.gz');
  assert.equal(archiveStatus('./archive.gz').exportedAt,b.exportedAt);
  writeFileSync('./bad.gz','broken archive');renameSync('./bad.gz','./archive.gz');
  assert.throws(()=>archiveStatus('./archive.gz'));
  unlinkSync('./archive.gz');assert.equal(archiveStatus('./archive.gz').present,false);
  writeArchive(a,'./archive.gz');assert.equal(archiveStatus('./archive.gz').exportedAt,a.exportedAt);
`));
