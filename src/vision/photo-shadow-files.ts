/**
 * Original photo bytes for shadow reads. Luna reads them right after download;
 * Gemma may read them hours later when the GPU is idle, by which time
 * marketplace CDN links can have expired. So a photo set is kept until Gemma
 * has handled it, the listing retires, or 72 hours pass, then deleted.
 * Photos are working files, never an asset (see RETENTION in photos/index.ts).
 */
import type {Database} from 'bun:sqlite';
import sharp from 'sharp';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {PHOTO_DIR,dhash,fetchPhoto} from '../photos/index.ts';
import {fingerprintOf} from './merge.ts';
import {MAX_SHADOW_PHOTOS,pendingVerification,sha256,urlKey,type PhotoSet,type ShadowImage} from './photo-shadow.ts';

const MIME:Record<string,string>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
export const shadowRoot=()=>resolve(PHOTO_DIR,'shadow');
const setDir=(listingId:number,fingerprint:string)=>{
  if(!Number.isSafeInteger(listingId)||listingId<=0||!/^[a-f0-9]{32}$/.test(fingerprint))throw new Error('invalid photo set');
  return join(shadowRoot(),String(listingId),fingerprint);
};

/** Download every photo, unmodified. One unreadable photo fails the set: a reader must never see a partial gallery. */
export async function acquirePhotoSet(listingId:number,urls:string[],fetch=fetchPhoto):Promise<PhotoSet> {
  if(!urls.length||urls.length>MAX_SHADOW_PHOTOS)throw new Error('photo count outside the benchmarked range');
  const images:ShadowImage[]=[],phashes:string[]=[];
  for(const url of urls){
    const bytes=await fetch(url);
    const meta=await sharp(bytes).metadata();
    const mime=MIME[meta.format??''];
    if(!mime||!meta.width||!meta.height)throw new Error(`unsupported or unreadable image (${meta.format??'unknown'})`);
    images.push({bytes,mime,width:meta.width,height:meta.height});phashes.push(await dhash(bytes));
  }
  const set={listingId,urlKey:urlKey(urls),fingerprint:fingerprintOf(phashes),imageHashes:images.map(i=>sha256(i.bytes)),images};
  const dir=setDir(listingId,set.fingerprint);mkdirSync(dir,{recursive:true});
  images.forEach((img,i)=>writeFileSync(join(dir,`p${i}`),img.bytes));
  writeFileSync(join(dir,'set.json'),JSON.stringify({urlKey:set.urlKey,imageHashes:set.imageHashes,images:images.map(i=>({mime:i.mime,width:i.width,height:i.height})),savedAt:new Date().toISOString()}));
  return set;
}

/** The exact bytes Luna read, verified by hash, or null when they are gone or altered. */
export function loadPhotoSet(listingId:number,fingerprint:string):PhotoSet|null {
  const dir=setDir(listingId,fingerprint);
  try{
    const meta=JSON.parse(readFileSync(join(dir,'set.json'),'utf8')) as {urlKey:string;imageHashes:string[];images:{mime:string;width:number;height:number}[]};
    const images=meta.images.map((m,i)=>({...m,bytes:new Uint8Array(readFileSync(join(dir,`p${i}`)))}));
    if(images.some((img,i)=>sha256(img.bytes)!==meta.imageHashes[i]))return null;
    return {listingId,urlKey:meta.urlKey,fingerprint,imageHashes:meta.imageHashes,images};
  }catch{return null;}
}

/** Keep only sets Gemma still has to read (latest Luna read of a live listing) and younger than `maxAgeHours`. */
export function pruneShadowPhotos(d:Database,opts:{maxAgeHours?:number;now?:number}={}) {
  const root=shadowRoot();if(!existsSync(root))return {removed:0};
  const cutoff=(opts.now??Date.now())-(opts.maxAgeHours??72)*3600_000;let removed=0;
  const waiting=new Set(pendingVerification(d,Number.MAX_SAFE_INTEGER).map(p=>`${p.listingId}/${p.fingerprint}`));
  for(const listing of readdirSync(root)){
    const listingDir=join(root,listing);
    for(const fp of readdirSync(listingDir)){
      const dir=join(listingDir,fp);
      if(!waiting.has(`${listing}/${fp}`)||statSync(dir).mtimeMs<cutoff){rmSync(dir,{recursive:true,force:true});removed++;}
    }
    if(!readdirSync(listingDir).length)rmSync(listingDir,{recursive:true,force:true});
  }
  return {removed};
}
