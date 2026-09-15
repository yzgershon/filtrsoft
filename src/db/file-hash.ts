import {createHash} from 'node:crypto';
import {openSync,readSync,closeSync} from 'node:fs';

/** Production reached 4.45 GB. Reading a database into one Buffer just to hash
 * it can exhaust the server's memory before verification even starts. */
export function fileSha256(path:string):string {
  const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  try {
    let bytes:number;
    while((bytes=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));
    return hash.digest('hex');
  }finally{closeSync(fd);}
}
