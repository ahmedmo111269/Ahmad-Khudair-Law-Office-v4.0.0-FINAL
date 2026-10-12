import {prefs,scopedPreferenceKey} from '../core/preferences.js';
import {events} from '../core/events.js';
import {networkStatus} from '../core/network-status.js';
import {createSyncBundle,applySyncBundle,recordSyncExport,syncStatus,validateSyncBundle} from './sync-engine.js';
import {deriveRelayKey,encryptRelayEnvelope,decryptRelayEnvelope} from './sync-crypto.js';
import {readRelayCredential,saveRelayCredential,deleteRelayCredential} from './sync-vault.js';

const CONFIG_PREFIX='sync:relay-config';
const STATE_PREFIX='relay:';
const REQUEST_TIMEOUT_MS=20000;
const DOWNLOAD_PAGE_SIZE=5;
const BACKGROUND_INTERVAL_MS=90000;
const MAX_CONTINUATION_CYCLES=20;
const running=new Map();

const profileKey=profileId=>scopedPreferenceKey(CONFIG_PREFIX,String(profileId||''));
const relayStateId=(profileId,workspaceId)=>`${STATE_PREFIX}${String(profileId||'')}:${String(workspaceId||'')}`;

export function normalizeRelayEndpoint(value){
 let url;
 try{url=new URL(String(value||'').trim())}catch{throw new Error('أدخل عنوان الخادم كاملًا، مثل https://sync.example.org.')}
 const localHost=['localhost','127.0.0.1','::1'].includes(url.hostname)||url.hostname.endsWith('.localhost');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&localHost))throw new Error('يلزم HTTPS للخادم. يُسمح بـ HTTP على localhost للاختبار فقط.');
 if(url.username||url.password||url.search||url.hash)throw new Error('عنوان الخادم لا يقبل اسم مستخدم أو كلمة مرور أو معاملات URL.');
 url.pathname=url.pathname.replace(/\/+$/,'');
 return url.toString().replace(/\/$/,'');
}

export function validateRelayWorkspaceId(value){
 const id=String(value||'').trim();
 if(!/^[A-Za-z0-9_-]{16,120}$/.test(id))throw new Error('معرّف مساحة المزامنة يجب أن يتكون من 16 إلى 120 حرفًا/رقمًا أو شرطة.');
 return id;
}

export function getRelayConfiguration(profileId){
 const row=prefs.get(profileKey(profileId),null);
 if(!row||typeof row!=='object')return {enabled:false,autoSync:false};
 try{return {...row,endpoint:normalizeRelayEndpoint(row.endpoint),workspaceId:validateRelayWorkspaceId(row.workspaceId),enabled:row.enabled===true,autoSync:row.autoSync===true}}
 catch{return {enabled:false,autoSync:false,invalid:true}}
}

export async function configureSyncRelay(profileId,{endpoint,workspaceId,token,passphrase,autoSync=true}={}){
 const profile=String(profileId||'');
 if(!profile)throw new Error('قاعدة البيانات النشطة غير معروفة.');
 const normalizedEndpoint=normalizeRelayEndpoint(endpoint);
 const workspace=validateRelayWorkspaceId(workspaceId);
 const existing=await readRelayCredential(profile).catch(()=>null);
 const cleanToken=String(token||existing?.token||'').trim();
 if(cleanToken.length<32||cleanToken.length>512)throw new Error('أدخل رمز وصول من 32 إلى 512 حرفًا؛ يُنشئه مسؤول خادم المزامنة.');
 let key;
 if(String(passphrase||''))key=await deriveRelayKey(passphrase,workspace);
 else if(existing?.key&&existing.workspaceId===workspace)key=existing.key;
 else throw new Error('عبارة التشفير المشتركة مطلوبة عند إنشاء اتصال أو تغيير مساحة المزامنة.');
 cancelAutomaticSyncRelay(profile,'configuration');
 await saveRelayCredential(profile,{token:cleanToken,key,workspaceId:workspace});
 const config={enabled:true,autoSync:Boolean(autoSync),endpoint:normalizedEndpoint,workspaceId:workspace,updatedAt:new Date().toISOString()};
 await prefs.set(profileKey(profile),config);
 return config;
}

export async function setRelayAutoSync(profileId,enabled){
 const current=getRelayConfiguration(profileId);
 if(!current.endpoint||!current.workspaceId)throw new Error('أعد إعداد اتصال خادم المزامنة أولًا.');
 const updated={...current,enabled:true,autoSync:Boolean(enabled),updatedAt:new Date().toISOString()};
 await prefs.set(profileKey(profileId),updated);
 if(!enabled)cancelAutomaticSyncRelay(profileId,'disabled');
 return updated;
}

export async function disableSyncRelay(profileId,{forgetSecrets=false}={}){
 const profile=String(profileId||''),current=getRelayConfiguration(profile);
 cancelAutomaticSyncRelay(profile,'disabled');
 if(forgetSecrets){await prefs.remove(profileKey(profile));await deleteRelayCredential(profile);return {enabled:false,autoSync:false}}
 const next={...current,enabled:false,autoSync:false,updatedAt:new Date().toISOString()};
 await prefs.set(profileKey(profile),next);
 return next;
}

function apiUrl(config,path){return `${config.endpoint}/v1/relay/${encodeURIComponent(config.workspaceId)}${path}`}
function healthUrl(config){return `${config.endpoint}/v1/health`}
async function relayFetch(url,{credential,method='GET',body=null,signal=null,timeout=REQUEST_TIMEOUT_MS}={}){
 const controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason||new DOMException('Aborted','AbortError'));
 if(signal?.aborted)abort();else signal?.addEventListener?.('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeout);
 try{
  const headers={Accept:'application/json'};
  if(credential?.token)headers.Authorization=`Bearer ${credential.token}`;
  if(body!==null)headers['Content-Type']='application/json';
  let response;
  try{response=await fetch(url,{method,headers,body:body===null?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,mode:'cors'})}
  catch(error){if(controller.signal.aborted)throw signal?.aborted?(signal.reason||error):new Error('تعذر الاتصال بخادم المزامنة. تحقق من الشبكة وعنوان الخادم وCORS.');throw error}
  if(!response.ok){
   const detail=await response.text().catch(()=>''),message=detail.slice(0,240);
   if(response.status===401||response.status===403)throw new Error('رفض خادم المزامنة رمز الوصول؛ تحقق من إعداد الجهاز أو اطلب رمزًا صالحًا.');
   if(response.status===404)throw new Error('مساحة المزامنة أو مسار API غير موجود على الخادم.');
   if(response.status===409)throw new Error(`رفض الخادم الحزمة لتعارض في المعرّف: ${message||'409'}`);
   if(response.status===413)throw new Error('حزمة المزامنة أكبر من حد الخادم؛ خفّض حجم الدفعة أو ارفع حد الخادم.');
   if(response.status===429)throw new Error('أوقف الخادم الطلبات مؤقتًا بسبب كثرتها؛ ستُعاد المحاولة بعد مهلة.');
   throw new Error(`خادم المزامنة أعاد الحالة ${response.status}${message?`: ${message}`:''}.`);
  }
  const text=await response.text();
  if(!text)return {};
  try{return JSON.parse(text)}catch{throw new Error('ردّ خادم المزامنة ليس JSON صالحًا.')}
 }finally{clearTimeout(timer);signal?.removeEventListener?.('abort',abort)}
}

export async function testSyncRelay(profileId,{passphrase='',endpoint='',workspaceId='',token=''}={}){
 const config=endpoint||workspaceId?{enabled:true,endpoint:normalizeRelayEndpoint(endpoint),workspaceId:validateRelayWorkspaceId(workspaceId)}:getRelayConfiguration(profileId);
 let credential=await readRelayCredential(profileId).catch(()=>null);
 if(token||passphrase){
  const workspace=config.workspaceId;
  const key=passphrase?await deriveRelayKey(passphrase,workspace):(credential?.workspaceId===workspace?credential?.key:null);
  credential={...credential,token:String(token||credential?.token||''),key,workspaceId:workspace};
 }
 if(!credential?.token||!credential?.key||credential.workspaceId!==config.workspaceId)throw new Error('بيانات الاتصال أو مفتاح التشفير غير مكتملين لهذه المساحة؛ أدخل العبارة المشتركة ورمزًا صالحًا.');
 const health=await relayFetch(healthUrl(config));
 if(health.service!=='akl-sync-relay'||Number(health.protocolVersion)!==1)throw new Error('الخادم متاح لكنه لا يعلن بروتوكول مزامنة المكتب المدعوم.');
 const page=await relayFetch(`${apiUrl(config,'/packages')}?after=0&limit=1`,{credential});
 const sample=page.items?.[0];
 if(sample?.sealed)await decryptRelayEnvelope(sample.sealed,credential.key);
 return {ok:true,service:health.service,packagesAvailable:Number(page.total||0),keyVerified:Boolean(sample?.sealed)};
}

function readRelayState(ctx,profileId,workspaceId){
 ctx.assert();const raw=ctx.rawDb||ctx.db,id=relayStateId(profileId,workspaceId);
 return new Promise((resolve,reject)=>{
  let tx,request;
  try{tx=raw.transaction('syncState','readonly');request=tx.objectStore('syncState').get(id)}catch(error){reject(error);return}
  request.onsuccess=()=>resolve(request.result?.value&&typeof request.result.value==='object'?request.result.value:{cursor:0,serverVector:{}});
  request.onerror=()=>reject(request.error||new Error('تعذرت قراءة موضع مزامنة الخادم.'));
 });
}
function writeRelayState(ctx,profileId,workspaceId,value){
 ctx.assert();const raw=ctx.rawDb||ctx.db,id=relayStateId(profileId,workspaceId);
 return new Promise((resolve,reject)=>{
  let tx;try{tx=raw.transaction('syncState','readwrite');tx.objectStore('syncState').put({id,value:{...value,workspaceId:String(workspaceId||'')},updatedAt:new Date().toISOString()})}catch(error){reject(error);return}
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('تعذر حفظ موضع مزامنة الخادم محليًا.'));tx.onabort=()=>reject(tx.error||new Error('أُلغيت كتابة موضع مزامنة الخادم.'));
 });
}
async function acquireLock(ctx,profileId){
 ctx.assert();const raw=ctx.rawDb||ctx.db,id=`relay-lock:${String(profileId)}`,owner=`${ctx.token}:${Date.now()}`;
 return new Promise((resolve,reject)=>{
  let tx;try{tx=raw.transaction('syncState','readwrite');const store=tx.objectStore('syncState'),get=store.get(id);let acquired=false;
   get.onsuccess=()=>{const lock=get.result?.value;if(lock?.expiresAt>Date.now())return;acquired=true;store.put({id,value:{owner,expiresAt:Date.now()+REQUEST_TIMEOUT_MS*3}})};
   tx.oncomplete=()=>resolve(acquired?{id,owner}:null);tx.onerror=()=>reject(tx.error||new Error('تعذر حجز مزامنة هذا الجهاز.'));tx.onabort=()=>reject(tx.error||new Error('أُلغيت محاولة حجز المزامنة.'))
  }catch(error){reject(error)}
 });
}
async function releaseLock(ctx,lock){
 if(!lock)return;const raw=ctx.rawDb||ctx.db;
 await new Promise(resolve=>{
  try{const tx=raw.transaction('syncState','readwrite'),store=tx.objectStore('syncState'),get=store.get(lock.id);get.onsuccess=()=>{if(get.result?.value?.owner===lock.owner)store.delete(lock.id)};tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve}catch{resolve()}
 });
}
const maxInto=(vector,origin,sequence)=>{if(origin&&Number.isSafeInteger(Number(sequence))&&Number(sequence)>0)vector[origin]=Math.max(Number(vector[origin]||0),Number(sequence))};
function addBundleVector(vector,bundle){
 // لا نثق بمتجه «المعرفة» المعلن وحده: نتقدم فقط عبر التغييرات الموجودة فعليًا في حزم الخادم.
 for(const change of bundle.changes||[])maxInto(vector,change.originDeviceId,change.originSequence);
}
async function syncRelayCycle(ctx,profileId,{signal,onProgress=()=>{}}={}){
 ctx.assert();
 if(!networkStatus.isOnline())return {status:'offline',downloaded:0,uploaded:0};
 const config=getRelayConfiguration(profileId);
 if(!config.enabled)return {status:'disabled',downloaded:0,uploaded:0};
 const credential=await readRelayCredential(profileId);
 if(!credential?.key||!credential?.token||credential.workspaceId!==config.workspaceId)throw new Error('اتصال خادم المزامنة غير مكتمل؛ أعد حفظ الإعدادات على هذا الجهاز.');
 const local=await syncStatus(ctx);
 if(local.status==='SYNCING')return {status:'busy',downloaded:0,uploaded:0};
 if(!local.baselineComplete)return {status:'needs-baseline',downloaded:0,uploaded:0};
 const lock=await acquireLock(ctx,profileId);
 if(!lock)return {status:'busy',downloaded:0,uploaded:0};
 let downloaded=0,uploaded=0;
 try{
  let state=await readRelayState(ctx,profileId,config.workspaceId),cursor=Math.max(0,Number(state.cursor)||0);
  let serverVector={...(state.serverVector||{})};
  let pageCount=0;
  while(true){
   if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
   if(++pageCount>500)throw new Error('تجاوز الخادم 500 صفحة في جلسة واحدة؛ أوقف النقل لحماية المتصفح.');
   const pageStartCursor=cursor;
   const page=await relayFetch(`${apiUrl(config,'/packages')}?after=${encodeURIComponent(cursor)}&limit=${DOWNLOAD_PAGE_SIZE}`,{credential,signal});
   if(!Array.isArray(page.items))throw new Error('استجابة قائمة الحزم من الخادم غير صالحة.');
   for(const item of page.items){
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const nextCursor=Number(item.cursor);
    if(!Number.isSafeInteger(nextCursor)||nextCursor<=cursor)throw new Error('أعاد الخادم موضعًا غير متزايد؛ أُوقفت المزامنة لتجنب تخطي البيانات.');
    const bundle=await decryptRelayEnvelope(item.sealed,credential.key);
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const sameDevice=bundle.sourceDeviceId===ctx.deviceId;
    validateSyncBundle(bundle,{deviceId:sameDevice?'__relay-package-validation__':ctx.deviceId});
    addBundleVector(serverVector,bundle);
    if(!sameDevice){
     const result=await applySyncBundle(ctx,bundle,{signal,onProgress:progress=>onProgress({phase:'download',processed:progress.processed,total:progress.total,conflicts:progress.conflicts,peer:bundle.sourceDeviceName})});
     downloaded+=Number(result.applied||0)+Number(result.skipped||0)+Number(result.conflicts||0);
    }
    cursor=nextCursor;
    state={...state,cursor,serverVector,lastPullAt:new Date().toISOString()};
    await writeRelayState(ctx,profileId,config.workspaceId,state);
   }
   const next=Number(page.nextCursor??cursor);
   if(!Number.isSafeInteger(next)||next!==cursor)throw new Error('مؤشر صفحة الخادم لا يطابق آخر حزمة تم التحقق منها؛ أُوقفت المزامنة دون تخطي بيانات.');
   if(page.hasMore!==true)break;
   if(!page.items.length||cursor<=pageStartCursor)throw new Error('لم يتقدم مؤشر صفحات الخادم؛ أُوقفت المزامنة لتجنب تكرار لا نهائي.');
   state={...state,cursor,serverVector};await writeRelayState(ctx,profileId,config.workspaceId,state);
  }
  if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
  const peerVector={...serverVector};
  const outgoing=await createSyncBundle(ctx,{peerKnownVector:peerVector});
  if(outgoing.changes.length){
   const sealed=await encryptRelayEnvelope(outgoing,credential.key);
   const response=await relayFetch(apiUrl(config,'/packages'),{credential,method:'POST',body:{packageId:outgoing.packageId,sealed},signal});
   const serverCursor=Number(response.cursor||0);
   if(!Number.isSafeInteger(serverCursor)||serverCursor<1)throw new Error('لم يؤكد خادم المزامنة موضع الحزمة المرفوعة.');
   addBundleVector(serverVector,outgoing);
   uploaded=outgoing.changes.length;
   // Push cursor is diagnostic only: advancing the pull cursor here can skip a package
   // inserted by another device between our final GET and this POST.
   state={...state,cursor,serverVector,lastPushAt:new Date().toISOString(),lastPushCursor:serverCursor,lastPackageId:outgoing.packageId};
   await writeRelayState(ctx,profileId,config.workspaceId,state);
   await recordSyncExport(ctx,outgoing);
  }
  state={...state,cursor,serverVector,lastSyncAt:new Date().toISOString(),lastError:null};
  await writeRelayState(ctx,profileId,config.workspaceId,state);
  return {status:'synced',downloaded,uploaded,hasMore:outgoing.hasMore,cursor};
 }catch(error){
  if(signal?.aborted)throw error;
  const state=await readRelayState(ctx,profileId,config.workspaceId).catch(()=>({}));
  await writeRelayState(ctx,profileId,config.workspaceId,{...state,lastError:{message:String(error?.message||error).slice(0,300),at:new Date().toISOString()}}).catch(()=>{});
  throw error;
 }finally{await releaseLock(ctx,lock)}
}

async function completeRelaySync(ctx,profileId,options={}){
 let downloaded=0,uploaded=0,result=null,cycles=0;
 for(;cycles<MAX_CONTINUATION_CYCLES;cycles++){
  result=await syncRelayCycle(ctx,profileId,options);
  downloaded+=Number(result.downloaded||0);uploaded+=Number(result.uploaded||0);
  if(result.status!=='synced'||!result.hasMore)break;
  options.onProgress?.({phase:'continuation',cycle:cycles+2,downloaded,uploaded});
 }
 if(result?.hasMore&&cycles>=MAX_CONTINUATION_CYCLES)throw new Error('تتجاوز التغييرات حد 20 دفعة متتابعة؛ أُرسلت الدفعات المنجزة ويمكن تكرار المزامنة بأمان.');
 return {...result,downloaded,uploaded,cycles:cycles+1};
}

export async function syncViaRelay(ctx,profileId=ctx?.profile?.id,options={}){
 return completeRelaySync(ctx,String(profileId||''),options);
}

export function startAutomaticSyncRelay(ctx,{profileId=ctx?.profile?.id,onStatus=()=>{}}={}){
 const profile=String(profileId||'');
 if(!ctx||!profile)return ()=>{};
 const old=running.get(profile);old?.stop?.();
 let stopped=false,timer=null,inFlight=false,rerunRequested=false,failures=0,lastStarted=0,controller=null;
 const report=(status,details={})=>{try{onStatus({status,...details})}catch(error){console.warn('Sync relay status handler failed',error)}};
 const stop=()=>{
  if(stopped)return;stopped=true;if(timer)clearTimeout(timer);timer=null;
  controller?.abort(new DOMException('Automatic relay service stopped','AbortError'));
  offWrites?.();offOnline?.();globalThis.document?.removeEventListener?.('visibilitychange',visibility);
  globalThis.window?.removeEventListener?.('online',online);globalThis.window?.removeEventListener?.('focus',focus);
  if(running.get(profile)?.stop===wrappedStop)running.delete(profile);
 };
 const schedule=(delay=1300,reason='change')=>{
  if(stopped||timer)return;
  const cfg=getRelayConfiguration(profile);if(!cfg.enabled||!cfg.autoSync)return;
  timer=setTimeout(()=>{timer=null;void run(reason)},delay);
 };
 const run=async reason=>{
  if(stopped)return;
  if(inFlight){rerunRequested=true;return}
  const cfg=getRelayConfiguration(profile);if(!cfg.enabled||!cfg.autoSync){report('disabled');return}
  if(!networkStatus.isOnline()){report('offline');return}
  if(globalThis.document?.visibilityState==='hidden'&&reason!=='online'&&reason!=='interval')return;
  const since=Date.now()-lastStarted;if(since<6000){schedule(6000-since,reason);return}
  inFlight=true;lastStarted=Date.now();controller=new AbortController();report('syncing',{reason});
  try{
   const result=await completeRelaySync(ctx,profile,{signal:controller.signal,onProgress:progress=>report('syncing',progress)});
   failures=0;report(result.status==='needs-baseline'?'needs-baseline':result.status,{...result,reason});
  }catch(error){
   const latest=getRelayConfiguration(profile);
   if(controller?.signal.aborted){
    if(latest.enabled&&latest.autoSync)schedule(500,'configuration');
    else report('disabled',{reason});
   }else{
    failures=Math.min(failures+1,8);report('failed',{message:String(error?.message||error),retryInMs:Math.min(15*60*1000,5000*2**(failures-1)),reason});
    schedule(Math.min(15*60*1000,5000*2**(failures-1)),'retry');
   }
  }finally{
   controller=null;inFlight=false;
   if(rerunRequested){rerunRequested=false;schedule(500,'change')}
  }
 };
 const offWrites=events.on('db:write',payload=>{if(payload?.databaseName&&payload.databaseName===ctx.profile?.databaseName)schedule(1600,'change')});
 const offOnline=networkStatus.subscribe(({status})=>{if(status==='ONLINE')schedule(300,'online');else report('offline')});
 const online=()=>schedule(300,'online'),focus=()=>schedule(500,'focus'),visibility=()=>{if(globalThis.document?.visibilityState==='visible')schedule(500,'visible')};
 globalThis.window?.addEventListener?.('online',online);globalThis.window?.addEventListener?.('focus',focus);globalThis.document?.addEventListener?.('visibilitychange',visibility);
 const interval=setInterval(()=>schedule(0,'interval'),BACKGROUND_INTERVAL_MS);
 let wrappedStop;
 wrappedStop=()=>{clearInterval(interval);stop()};
 running.set(profile,{stop:wrappedStop,schedule:(delay=400,reason='manual')=>schedule(delay,reason),cancel:reason=>controller?.abort(new DOMException(`Automatic relay sync cancelled: ${reason||'configuration'}`,'AbortError'))});
 schedule(1800,'startup');
 return wrappedStop;
}

export function triggerAutomaticSyncRelay(profileId,reason='configuration'){
 const service=running.get(String(profileId||''));
 service?.schedule?.(350,reason);
}
export function cancelAutomaticSyncRelay(profileId,reason='configuration'){
 running.get(String(profileId||''))?.cancel?.(reason);
}
