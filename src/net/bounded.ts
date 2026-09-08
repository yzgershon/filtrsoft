/** Bound headers AND body. Content-Length is only a hint; streamed bytes are
 * counted as well so a chunked response cannot exhaust the API's memory.
 */
export async function fetchBytes(url:string,opts:{timeoutMs?:number;maxBytes?:number;headers?:Record<string,string>}={}):Promise<Buffer> {
  const controller=new AbortController();
  const timeoutMs=opts.timeoutMs??15_000,maxBytes=opts.maxBytes??12*1024*1024;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Remote read timed out'));},timeoutMs);});
  const work=(async()=>{
    const response=await fetch(url,{headers:opts.headers,signal:controller.signal});
    if(!response.ok)throw new Error(`Remote HTTP ${response.status}`);
    if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('Remote input exceeds byte limit');
    if(!response.body)return Buffer.alloc(0);
    reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    for(;;) {
      const result=await reader.read();if(result.done)break;
      bytes+=result.value.byteLength;if(bytes>maxBytes)throw new Error('Remote input exceeds byte limit');
      chunks.push(result.value);
    }
    return Buffer.concat(chunks,bytes);
  })();
  try {return await Promise.race([work,deadline]);}
  finally {clearTimeout(timer!);controller.abort();void reader?.cancel().catch(()=>{});}
}
