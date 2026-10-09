// Central, user-scoped state for collapsible UI. Default, current, and pinned state
// are deliberately stored separately so changing the default never overwrites a
// choice the user has already made for an element.
import {prefs} from '../core/preferences.js';

export const COLLAPSE_PREF_KEY='ui:collapse-state';
export const COLLAPSE_MODES=Object.freeze(['collapsed','open','last','pinned']);
export const COLLAPSE_MODE_LABELS=Object.freeze({
 collapsed:'مطوي',
 open:'مفتوح',
 last:'آخر حالة',
 pinned:'تثبيت حالتي'
});
// الوضع الافتراضي على الهاتف قد يختلف عن الكمبيوتر (مثل: طي الكل على الشاشات الصغيرة).
export const COLLAPSE_MOBILE_MODES=Object.freeze(['same','collapsed','open']);
export const COLLAPSE_MOBILE_MODE_LABELS=Object.freeze({
 same:'نفس وضع الكمبيوتر',
 collapsed:'مطوي على الهاتف',
 open:'مفتوح على الهاتف'
});

const blank=()=>({version:1,defaultState:'collapsed',defaultStateMobile:'same',legacyDisabled:false,items:{}});
const validMode=mode=>COLLAPSE_MODES.includes(mode)?mode:'collapsed';
const validMobileMode=mode=>COLLAPSE_MOBILE_MODES.includes(mode)?mode:'same';
const isBool=value=>typeof value==='boolean';
/** شاشة الهاتف الحالية — نافذة المتصفح أو نمط العرض، بلا اعتماد على جهاز محدد. */
export function isMobileView(){
 try{return Boolean(globalThis.matchMedia?.('(max-width:700px)').matches)}catch{return false}
}

function read(){
 const raw=prefs.get(COLLAPSE_PREF_KEY,null);
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return blank();
 const items=raw.items&&typeof raw.items==='object'&&!Array.isArray(raw.items)?raw.items:{};
 return {version:1,defaultState:validMode(raw.defaultState),defaultStateMobile:validMobileMode(raw.defaultStateMobile),legacyDisabled:Boolean(raw.legacyDisabled),items};
}
function write(next){
 // prefs.set mirrors synchronously to localStorage and then persists to IndexedDB.
 prefs.set(COLLAPSE_PREF_KEY,next);
 return next;
}

/** A copy of the global collapse configuration, safe for UI rendering. */
export function getCollapsePreferences(){
 const state=read();
 return {version:state.version,defaultState:state.defaultState,defaultStateMobile:state.defaultStateMobile,legacyDisabled:state.legacyDisabled,items:{...state.items}};
}
export const getDefaultCollapseState=()=>read().defaultState;
export const getDefaultCollapseStateMobile=()=>read().defaultStateMobile;
/** الوضع الفعّال الآن: وضع الهاتف إن كان مختلفًا، وإلا وضع الكمبيوتر. */
export function effectiveDefaultMode(){
 const state=read();
 if(isMobileView()&&state.defaultStateMobile!=='same'&&['open','collapsed'].includes(state.defaultStateMobile))return state.defaultStateMobile;
 return state.defaultState;
}
export function isDefaultCollapsed({fallback=true,primary=false,configured=false}={}){
 const mode=effectiveDefaultMode();
 if(primary||configured)return Boolean(fallback);
 if(mode==='open')return false;
 if(mode==='collapsed')return true;
 return Boolean(fallback);
}
export const getCollapseRecord=key=>key?read().items[key]||null:null;
export const isCollapsePinned=key=>isBool(getCollapseRecord(key)?.pinnedCollapsed);

/**
 * Resolve the initial visual state for one stable element key.
 * Existing per-element choices always win. `primary` is used for the main data
 * grid: it stays visible by default to honor the data-first experience; users
 * may still collapse it and that current state is remembered like any other.
 * `legacy` is a one-time compatibility value from older UI preferences.
 */
export function resolveCollapseState(key,{fallback=true,legacy,primary=false,configured=false}={}){
 const state=read();
 const item=key?state.items[key]:null;
 if(isBool(item?.pinnedCollapsed))return item.pinnedCollapsed;
 if(isBool(item?.currentCollapsed))return item.currentCollapsed;
 if(!state.legacyDisabled&&isBool(legacy))return legacy;
 // Main data sections and explicitly configured elements retain their local
 // starting point; global defaults apply to all other new, unconfigured items.
 if(primary||configured)return Boolean(fallback);
 switch(effectiveDefaultMode()){
  case'open':return false;
  case'collapsed':return true;
  case'last':
  case'pinned':
  default:return Boolean(fallback);
 }
}

/** Save a user's current choice; a pinned item follows every manual change. */
export function saveCollapseState(key,collapsed){
 if(!key)return null;
 const state=read(),prior=state.items[key]||{};
 const value=Boolean(collapsed);
 const pinByDefault=state.defaultState==='pinned'&&prior.pinDisabled!==true;
 const pinned=isBool(prior.pinnedCollapsed)||pinByDefault?value:null;
 state.items={...state.items,[key]:{currentCollapsed:value,pinnedCollapsed:pinned,pinDisabled:prior.pinDisabled===true,updatedAt:Date.now()}};
 return write(state);
}

/** Pin the current open/closed value, or unpin it without losing current state. */
export function toggleCollapsePin(key,currentCollapsed){
 if(!key)return null;
 const state=read(),prior=state.items[key]||{};
 const current=isBool(currentCollapsed)?currentCollapsed:Boolean(prior.currentCollapsed);
 const wasPinned=isBool(prior.pinnedCollapsed);
 state.items={...state.items,[key]:{
  ...prior,
  currentCollapsed:current,
  pinnedCollapsed:wasPinned?null:current,
  pinDisabled:wasPinned,
  updatedAt:Date.now()
 }};
 return write(state);
}

export function setDefaultCollapseState(mode){
 const state=read();state.defaultState=validMode(mode);write(state);return state.defaultState;
}
export function setDefaultCollapseStateMobile(mode){
 const state=read();state.defaultStateMobile=validMobileMode(mode);write(state);return state.defaultStateMobile;
}

export function clearCollapseState(key){
 if(!key)return null;
 const state=read();if(!(key in state.items))return state;
 const items={...state.items};delete items[key];state.items=items;return write(state);
}

/** Reset all per-element current/pinned choices, retaining the selected default. */
export function resetCollapseStates(){
 const state=read();state.items={};state.legacyDisabled=true;return write(state);
}

export function countPinnedCollapseStates(){
 return Object.values(read().items).filter(item=>isBool(item?.pinnedCollapsed)).length;
}

/** Used only by tests to make central state isolated and deterministic. */
export function _resetCollapseStateForTests(){
 const state=blank();state.legacyDisabled=true;write(state);return state;
}
