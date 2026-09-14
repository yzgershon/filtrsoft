interface GoogleIdentity {
  initialize(options: {client_id:string;callback:(response:{credential:string})=>void}):void;
  renderButton(element:HTMLElement,options:Record<string,unknown>):void;
}
let pending:Promise<GoogleIdentity>|null=null;
const identity=()=> (window as unknown as {google?:{accounts?:{id?:GoogleIdentity}}}).google?.accounts?.id;

/** Share the pending load across sign-in/signup transitions. Previously the
 * second form found a script tag, initialized before it loaded, then lost the
 * first form's cancelled onload callback. Failure clears the promise for retry. */
export function loadGoogleIdentity():Promise<GoogleIdentity> {
  const ready=identity();if(ready)return Promise.resolve(ready);
  if(pending)return pending;
  pending=new Promise<GoogleIdentity>((resolve,reject)=>{
    let script=document.getElementById('gsi-script') as HTMLScriptElement|null;
    const created=!script;
    if(!script){script=document.createElement('script');script.id='gsi-script';script.src='https://accounts.google.com/gsi/client';script.async=true;}
    const cleanup=()=>{clearTimeout(timer);script!.removeEventListener('load',loaded);script!.removeEventListener('error',failed);};
    const failed=()=>{cleanup();script!.remove();reject(new Error('Google sign-in could not load. Try again or use email.'));};
    const loaded=()=>{const api=identity();if(!api){failed();return;}cleanup();resolve(api);};
    const timer=setTimeout(failed,15000);
    script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});
    if(created)document.head.appendChild(script);
  }).catch(error=>{pending=null;throw error;});
  return pending;
}
