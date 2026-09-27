import {CHANNEL} from './constants.js';
import {uid} from './id.js';
class Bus{
  constructor(){this.m=new Map();this.sourceId=uid();this.bc='BroadcastChannel' in window?new BroadcastChannel(CHANNEL):null}
  on(n,f){if(!this.m.has(n))this.m.set(n,new Set());this.m.get(n).add(f);return()=>this.m.get(n)?.delete(f)}
  emit(n,p={},broadcast=true){this.m.get(n)?.forEach(f=>f(p));if(broadcast&&this.bc){try{this.bc.postMessage({n,p,sourceId:this.sourceId,at:new Date().toISOString()})}catch{}}}
  listen(){if(this.bc)this.bc.onmessage=e=>{const d=e.data||{};if(d.sourceId===this.sourceId)return;this.m.get(d.n)?.forEach(f=>f(d.p||{}))}}
}
export const events=new Bus();events.listen();
