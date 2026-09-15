import {test} from 'bun:test';
import {isolated} from './isolated.ts';

test('backup checksum covers every byte across chunk boundaries and detects a changed tail',()=>isolated(`
  import {fileSha256} from '@/src/db/file-hash.ts';
  import {createHash,randomBytes} from 'node:crypto';
  import {writeFileSync} from 'node:fs';
  for(const size of [0,1048576,2097159]){
    const bytes=randomBytes(size);writeFileSync('fixture.bin',bytes);
    assert.equal(fileSha256('fixture.bin'),createHash('sha256').update(bytes).digest('hex'));
    if(size){const previous=fileSha256('fixture.bin');bytes[size-1]^=255;writeFileSync('fixture.bin',bytes);assert.notEqual(fileSha256('fixture.bin'),previous);}
  }
  assert.throws(()=>fileSha256('missing.bin'));
`));
