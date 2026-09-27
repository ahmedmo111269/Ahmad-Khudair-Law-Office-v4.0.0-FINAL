const ALPH='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(n,len){let s='';while(len--){s=ALPH[n%32]+s;n=Math.floor(n/32)}return s}
export function uid(){const now=Date.now();let r='';for(let i=0;i<10;i++)r+=ALPH[Math.floor(Math.random()*32)];return b32(now,10)+r}
