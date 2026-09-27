import {REGISTRY_KEY,REGISTRY_VERSION,APP_VERSION,DB_PREFIX} from '../core/constants.js';
import {uid} from '../core/id.js';
const blank=()=>({registryVersion:REGISTRY_VERSION,applicationVersion:APP_VERSION,profiles:[],activeProfileId:null,lastBootAt:null,lastCleanShutdown:true,bootLog:[]});
export class DatabaseRegistry{
  constructor(){this.recoveryMode=false;this.data=this.load()}
  load(){const raw=localStorage.getItem(REGISTRY_KEY);if(raw===null)return blank();try{const x=JSON.parse(raw);if(!x||!Array.isArray(x.profiles)){this.recoveryMode=true;return blank()}return {...blank(),...x,profiles:x.profiles}}catch{this.recoveryMode=true;return blank()}}
  save(){localStorage.setItem(REGISTRY_KEY,JSON.stringify(this.data))}
  reload(){const raw=localStorage.getItem(REGISTRY_KEY);if(!raw)throw Error('سجل قواعد البيانات غير موجود.');const x=JSON.parse(raw);if(!x||!Array.isArray(x.profiles))throw Error('سجل قواعد البيانات تالف.');this.data={...blank(),...x,profiles:x.profiles};this.recoveryMode=false;return this.data}
  log(event,meta={}){this.data.bootLog=[...this.data.bootLog,{event,meta,at:new Date().toISOString()}].slice(-100);this.save()}
  get active(){return this.data.profiles.find(p=>p.id===this.data.activeProfileId)||null}
  async scanRecoverableDatabases(){if(!globalThis.indexedDB?.databases)return [];const list=await indexedDB.databases();return list.filter(x=>x.name?.startsWith(DB_PREFIX)).map(x=>({databaseName:x.name,version:x.version||0})).filter(x=>x.databaseName)}
  adoptExisting(input){const existing=this.data.profiles.find(x=>x.databaseName===input.databaseName);if(existing){this.data.activeProfileId=existing.id;this.recoveryMode=false;this.save();return existing}const id=uid(),p={id,databaseName:input.databaseName,displayName:input.displayName||`قاعدة مستعادة ${id.slice(-6)}`,periodFrom:null,periodTo:null,status:'active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:input.version||0,applicationVersion:APP_VERSION,recordCounts:{}};this.data.profiles.push(p);this.data.activeProfileId=id;this.recoveryMode=false;this.save();this.log('registry:database-adopted',{id,databaseName:p.databaseName});return p}
  resetRegistry(){this.data=blank();this.recoveryMode=false;this.save();return this.ensureDefault()}
  ensureDefault(){const active=this.data.profiles.find(p=>p.status==='active');if(active){if(this.data.activeProfileId!==active.id){this.data.activeProfileId=active.id;this.save()}return active}const id=uid(),now=new Date().toISOString(),p={id,databaseName:DB_PREFIX+id,displayName:'قاعدة المكتب الرئيسية',periodFrom:null,periodTo:null,status:'active',createdAt:now,updatedAt:now,schemaVersion:0,applicationVersion:APP_VERSION,recordCounts:{}};this.data.profiles=[...this.data.profiles,p];this.data.activeProfileId=id;this.save();return p}
  add(input){const id=uid(),p={id,databaseName:DB_PREFIX+id,displayName:'قاعدة جديدة',periodFrom:null,periodTo:null,...input,status:'active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:0,applicationVersion:APP_VERSION,recordCounts:{}};this.data.profiles.push(p);this.data.activeProfileId=id;this.save();this.log('registry:database-created',{id});return p}
  switch(id){if(!this.data.profiles.some(p=>p.id===id))throw Error('قاعدة البيانات غير موجودة');this.data.activeProfileId=id;this.save();this.log('registry:database-switched',{id})}
  update(id,patch){const p=this.data.profiles.find(x=>x.id===id);if(p){Object.assign(p,patch,{updatedAt:new Date().toISOString()});this.save()}}
  archive(id){const p=this.data.profiles.find(x=>x.id===id);if(!p)throw Error('قاعدة البيانات غير موجودة');p.status='archived';p.updatedAt=new Date().toISOString();this.save();this.log('registry:database-archived',{id})}
  activate(id){const p=this.data.profiles.find(x=>x.id===id);if(!p)throw Error('قاعدة البيانات غير موجودة');p.status='active';p.updatedAt=new Date().toISOString();this.save();this.log('registry:database-activated',{id})}
}
