import type {Readable} from 'node:stream';
import type {Page} from 'playwright-core';
export function signedInFromHeader(state:{url:string;title:string;greeting:string;signInVisible:boolean;signOutVisible:boolean}):boolean;
export function readEbaySignInState(page:Page):Promise<boolean>;
export function waitForManualSignIn(options:{input:Readable;readSignedIn:()=>Promise<boolean>;pollMs?:number;maxWaitMs?:number}):Promise<'enter'|'detected'|'timeout'>;
