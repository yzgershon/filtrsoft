/** Facebook can put a video before the actual photos. Treating its MP4 as an
 * image breaks the feed and repeatedly spends the thumbnail download budget. */
export function isPhotoUrl(value:string):boolean {
  try {
    const url=new URL(value,'https://filtrsoft.com');
    return ['http:','https:'].includes(url.protocol) && !/\.(?:mp4|webm|m3u8|mov)$/i.test(url.pathname) && !/^video[-.]/i.test(url.hostname);
  } catch {return false;}
}
