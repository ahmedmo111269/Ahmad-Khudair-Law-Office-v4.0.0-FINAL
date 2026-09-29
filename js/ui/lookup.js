import {esc} from './dom.js';
import {normalizeArabic,normalizeDigits} from '../core/search-normalizer.js';
import {formatFileNumber} from '../core/file-number.js';

// Extra indexes searched for each store so the user can type a number OR a name/title.
const SEARCH_INDEXES={
 clients:[['fullNameNormalized','text'],['nationalId','digits']],
 files:[['fileNumber','digits'],['titleNormalized','text']],
 cases:[['caseNumber','digits'],['subjectNormalized','text']],
 opponents:[['nameNormalized','text']]
};

export function lookupField({name,label,store,index,display,placeholder='اكتب حرفين على الأقل…',value='',displayValue=''}){
 const listId=`lookup-${name}-${Math.random().toString(36).slice(2,8)}`;
 return `<label>${esc(label)}<input class="lookup-input" data-lookup-store="${esc(store)}" data-lookup-index="${esc(index)}" data-lookup-name="${esc(name)}" list="${listId}" value="${esc(displayValue)}" placeholder="${esc(placeholder)}" autocomplete="off"><input type="hidden" name="${esc(name)}" value="${esc(value)}"><datalist id="${listId}"></datalist></label>`;
}

async function findRows(office,store,index,raw){
 const specs=SEARCH_INDEXES[store]||[[index,index?.toLowerCase().includes('normalized')?'text':'digits']];
 const out=new Map();
 for(const [idx,kind] of specs){
  const q=kind==='text'?normalizeArabic(raw):normalizeDigits(raw).trim();
  if(!q)continue;
  try{for(const r of await office.r[store].prefix(idx,q,10))out.set(r.id,r)}catch{/* ignore a single failing index */}
  if(out.size>=10)break;
 }
 return [...out.values()].slice(0,10);
}

export function bindLookups(root,office){
 root?.querySelectorAll('.lookup-input').forEach(input=>{
  const list=root.querySelector('#'+input.getAttribute('list'));
  const hidden=input.parentElement.querySelector(`input[type="hidden"][name="${CSS.escape(input.dataset.lookupName)}"]`);
  const store=input.dataset.lookupStore;
  const labels=new Map(); // label -> id for the currently offered suggestions
  let timer,seq=0;
  const pick=()=>{const id=labels.get(input.value.trim());if(id){hidden.value=id;return true}return false};
  input.addEventListener('input',()=>{
   clearTimeout(timer);
   if(pick())return; // the user selected one of the offered suggestions
   hidden.value='';
   const raw=input.value.trim();
   if(raw.length<2){list.innerHTML='';labels.clear();return}
   const my=++seq;
   timer=setTimeout(async()=>{
    try{
     const rows=await findRows(office,store,input.dataset.lookupIndex,raw);
     if(my!==seq)return;
     labels.clear();
     list.innerHTML=rows.map(r=>{const text=formatValue(r,store);labels.set(text,r.id);return `<option value="${esc(text)}"></option>`}).join('');
     pick();
    }catch{list.innerHTML='';labels.clear()}
   },150);
  });
  input.addEventListener('change',pick);
 });
}

export function formatValue(r,store){
 if(store==='clients')return `${r.fullName||''}${r.nationalId?` — ${r.nationalId}`:''}`;
 if(store==='files')return `${formatFileNumber(r.fileNumber)} — ${r.title||''}`.trim().replace(/^— /,'');
 if(store==='cases')return `${r.caseNumber||''}/${r.caseYear||''} — ${r.courtId||''}`.trim();
 return r.name||r.title||r.id||'';
}
