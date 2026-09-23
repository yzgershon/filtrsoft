import {createInterface} from 'node:readline';

/** A generic "Hi! Sign in or register" header exists on fresh profiles too.
 * Require positive account evidence and let an explicit sign-in/challenge win. */
export function signedInFromHeader({url,title,greeting,signInVisible,signOutVisible}) {
  let location;try{location=new URL(url);}catch{return false;}
  if(!/(^|\.)ebay\.com$/i.test(location.hostname))return false;
  if(/^signin\./i.test(location.hostname)||/^\/signin(?:\/|$)/i.test(location.pathname))return false;
  if(/sign in|security measure|verify (?:your|you)|robot|captcha/i.test(title))return false;
  const text=(greeting??'').replace(/\s+/g,' ').trim();
  if(signInVisible||/sign in|register|\bguest\b/i.test(text))return false;
  const name=text.match(/^(?:hi|hello)[,\s]+([^!]+)!/i)?.[1]?.trim();
  return !!signOutVisible||!!name&&!/^[,\s]+$/.test(name);
}

export async function readEbaySignInState(page) {
  try {
    return signedInFromHeader({url:page.url(),title:await page.title(),
      greeting:(await page.locator('#gh-ug, [data-testid="greeting"]').allTextContents()).join(' '),
      signInVisible:await page.getByRole('link',{name:/^sign in$/i}).first().isVisible(),
      signOutVisible:await page.getByRole('link',{name:/^sign out$/i}).first().isVisible()});
  }catch{return false;}
}

/** EOF from a background launcher is not Yish pressing Enter. Never navigate
 * over an unfinished manual sign-in, and release timers when the wait ends. */
export function waitForManualSignIn({input,readSignedIn,pollMs=5000,maxWaitMs=15*60_000}) {
  return new Promise(resolve=>{
    const rl=createInterface({input});let finished=false,checking=false;
    const finish=reason=>{
      if(finished)return;finished=true;clearInterval(poll);clearTimeout(timeout);rl.close();resolve(reason);
    };
    const poll=setInterval(async()=>{
      if(checking||finished)return;checking=true;
      try{if(await readSignedIn())finish('detected');}catch{}finally{checking=false;}
    },pollMs);
    const timeout=setTimeout(()=>finish('timeout'),maxWaitMs);
    rl.once('line',()=>finish('enter'));
    // An ended stdin still leaves passive page detection and the timeout active.
  });
}
