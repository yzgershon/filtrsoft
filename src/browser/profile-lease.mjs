import {openSync,closeSync,readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

/** A profile is exclusively owned until its process exits. Time alone cannot
 * steal a live browser's profile; a sleeping laptop may resume that process.
 */
export function acquireProfileLease(profile) {
  const path=resolve(profile)+'.filtrsoft-owner.json';
  mkdirSync(dirname(path),{recursive:true});
  const owner={pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()};
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const fd=openSync(path,'wx');
      try {writeFileSync(fd,JSON.stringify(owner));}finally {closeSync(fd);}
      const release=()=>{
        try {if(JSON.parse(readFileSync(path,'utf8')).token===owner.token)unlinkSync(path);}catch {}
        process.removeListener('exit',release);
      };
      process.once('exit',release);
      return release;
    } catch(e) {
      if(e.code!=='EEXIST')throw e;
      let prior;
      try {prior=JSON.parse(readFileSync(path,'utf8'));}catch {throw new Error('Browser profile ownership is unreadable; refusing concurrent use');}
      if(!Number.isInteger(prior.pid)||prior.pid<=0)throw new Error('Invalid browser profile owner');
      let alive=true;
      try {process.kill(prior.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive)throw new Error(`Browser profile is in use by process ${prior.pid}`);
      // Serialize dead-owner recovery too: two reapers must not delete a new
      // owner's lock between their read and unlink operations.
      let guard;
      try {guard=openSync(path+'.reaping','wx');}catch {throw new Error('Browser profile recovery already in progress');}
      try {
        const current=JSON.parse(readFileSync(path,'utf8'));
        if(current.token===prior.token)unlinkSync(path);
      } finally {closeSync(guard);unlinkSync(path+'.reaping');}
    }
  }
  throw new Error('Browser profile claim raced another process; retry later');
}
