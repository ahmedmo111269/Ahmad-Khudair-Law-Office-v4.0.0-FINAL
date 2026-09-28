// محرك الثيمات: الثيمات الافتراضية + التخصيص الكامل + الثيمات المخصصة المسمّاة.
// التطبيق فوري عبر CSS Variables على <html> بدون إعادة تحميل. الحفظ في IndexedDB (preferences).
import {prefs} from '../core/preferences.js';

export const PRESETS={
 luxuryGold:{name:'Luxury Dark Gold',ar:'الأسود والذهبي الفاخر',desc:'الثيم الرئيسي — أسود عميق مع ذهب معدني',
  c:{bg:'#0B0B0B',surface:'#1A1A1A',chrome:'#101010',text:'#E9E6DF',textStrong:'#FFFFFF',textMuted:'#A9A396',primary:'#D4AF37',primary2:'#E8D48B'},meta:'#0B0B0B'},
 elegantLight:{name:'Elegant Light',ar:'الفاتح الأنيق',desc:'أبيض دافئ ونظيف بلمسة ذهبية داكنة',
  c:{bg:'#F8F7F4',surface:'#FFFFFF',chrome:'#FFFFFF',text:'#2A2723',textStrong:'#14120E',textMuted:'#6B665C',primary:'#8A6A12',primary2:'#B08A22'},meta:'#F8F7F4'},
 midnightBlue:{name:'Midnight Blue',ar:'الكحلي الليلي',desc:'كحلي هادئ مريح للقراءة الطويلة',
  c:{bg:'#0A1628',surface:'#132337',chrome:'#0D1C31',text:'#D9E2EE',textStrong:'#F4F7FB',textMuted:'#93A4BA',primary:'#D6B35A',primary2:'#EBD9A2'},meta:'#0A1628'},
 warmCharcoal:{name:'Warm Charcoal',ar:'الفحمي الدافئ',desc:'رمادي دافئ ولمسات برونزية لتقليل إجهاد العين',
  c:{bg:'#1C1A18',surface:'#262320',chrome:'#181614',text:'#E6DFD3',textStrong:'#FAF6EF',textMuted:'#ABA293',primary:'#C8925A',primary2:'#E3BF93'},meta:'#1C1A18'},
 emeraldCourt:{name:'Emerald Court',ar:'الزمردي القضائي',desc:'أخضر زمردي داكن مع ذهب — وقار قاعات المحاكم',
  c:{bg:'#07140F',surface:'#10231B',chrome:'#0A1A13',text:'#DCE8E1',textStrong:'#F4FAF6',textMuted:'#8FA89A',primary:'#D4AF37',primary2:'#E9D58E'},meta:'#07140F'},
 royalBurgundy:{name:'Royal Burgundy',ar:'العنابي الملكي',desc:'عنابي عميق بلمسات ذهبية وردية',
  c:{bg:'#160A0E',surface:'#241218',chrome:'#1B0D12',text:'#EDDFE2',textStrong:'#FFF7F8',textMuted:'#B39AA0',primary:'#D9A55B',primary2:'#EFCB97'},meta:'#160A0E'},
 pearlBlue:{name:'Pearl Blue',ar:'اللؤلؤي الأزرق',desc:'فاتح بارد ونقي بأزرق مؤسسي — مثالي للنهار',
  c:{bg:'#F3F6FA',surface:'#FFFFFF',chrome:'#FFFFFF',text:'#1F2A37',textStrong:'#0B1320',textMuted:'#5B6878',primary:'#1D4F91',primary2:'#3A73C0'},meta:'#F3F6FA'},
 desertSand:{name:'Desert Sand',ar:'الرملي الدافئ',desc:'بيج رملي هادئ وبني قهوة — ورقي مريح',
  c:{bg:'#F4EEE3',surface:'#FBF8F2',chrome:'#FBF8F2',text:'#3B3024',textStrong:'#21190F',textMuted:'#7A6B58',primary:'#8B5A2B',primary2:'#B07A43'},meta:'#F4EEE3'},
 highContrast:{name:'High Contrast',ar:'التباين العالي',desc:'أقصى وضوح للقراءة وضعاف البصر والشمس المباشرة',
  c:{bg:'#000000',surface:'#0A0A0A',chrome:'#000000',text:'#FFFFFF',textStrong:'#FFFFFF',textMuted:'#D0D0D0',primary:'#FFD400',primary2:'#FFE866'},meta:'#000000'}
};
export const LIGHT_PRESETS=['elegantLight','pearlBlue','desertSand'];
export const FONTS_AR=[
 {id:'Cairo',label:'القاهرة (Cairo)'},{id:'Tajawal',label:'تجوّل (Tajawal)'},{id:'Almarai',label:'المراعي (Almarai)'},
 {id:'IBM Plex Sans Arabic',label:'IBM Plex Arabic'},{id:'Noto Kufi Arabic',label:'نوتو كوفي'},{id:'Noto Naskh Arabic',label:'نوتو نسخ (كلاسيكي)'},
 {id:'Amiri',label:'أميري (قانوني فاخر)'},{id:'system',label:'خط النظام (بدون إنترنت)'}];
export const FONTS_EN=[{id:'Inter',label:'Inter'},{id:'Poppins',label:'Poppins'},{id:'Playfair Display',label:'Playfair Display'},{id:'Lato',label:'Lato'},{id:'system',label:'System'}];
export const FONT_SIZES={sm:14,md:15,lg:17,xl:19};
export const DENSITY={compact:.75,comfortable:1,spacious:1.3};

export const DEFAULT_CONFIG=Object.freeze({preset:'luxuryGold',colors:{},fontAr:'Cairo',fontEn:'Inter',headingFont:'',fontSize:'md',customSize:15,fontWeight:400,radius:14,density:'comfortable',effects:true,followSystem:false,customId:null});
const KEY='theme',CUSTOM='customThemes';
const listeners=new Set();
let current=null;

const clone=o=>JSON.parse(JSON.stringify(o));
export const getConfig=()=>current||(current=normalize(prefs.get(KEY)));
export function normalize(c){const x={...clone(DEFAULT_CONFIG),...(c||{})};x.colors={...(c?.colors||{})};if(!PRESETS[x.preset])x.preset='luxuryGold';return x}
export function onThemeChange(fn){listeners.add(fn);return ()=>listeners.delete(fn)}

const CSSVAR={bg:'--bg',surface:'--surface',chrome:'--chrome',text:'--text',textStrong:'--text-strong',textMuted:'--text-muted',primary:'--primary',primary2:'--primary-2'};
const loadedFonts=new Set();
function loadFont(name){
 if(!name||name==='system'||loadedFonts.has(name))return;
 loadedFonts.add(name);
 const l=document.createElement('link');l.rel='stylesheet';l.dataset.font=name;
 l.href=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g,'+')}:wght@300;400;500;600;700;800&display=swap`;
 document.head.append(l);
}
// ---- حساب التباين (WCAG) ----
const hex=h=>{h=String(h||'').replace('#','');if(h.length===3)h=h.split('').map(x=>x+x).join('');const n=parseInt(h,16);return [(n>>16)&255,(n>>8)&255,n&255]};
const lum=h=>{const [r,g,b]=hex(h).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
export const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
export function effectiveColors(c=getConfig()){return {...PRESETS[c.preset].c,...c.colors}}
function mix(a,b,t){const x=hex(a),y=hex(b);return '#'+x.map((v,i)=>Math.round(v*(1-t)+y[i]*t).toString(16).padStart(2,'0')).join('')}

export function applyTheme(cfg=getConfig(),{animate=true}={}){
 const c=normalize(cfg);const root=document.documentElement;
 let preset=c.preset;
 if(c.followSystem&&!c.customId){const light=matchMedia('(prefers-color-scheme: light)').matches;preset=light?(LIGHT_PRESETS.includes(c.preset)?c.preset:'elegantLight'):(LIGHT_PRESETS.includes(c.preset)?'luxuryGold':c.preset)}
 if(animate){root.classList.add('theme-animating');clearTimeout(applyTheme.t);applyTheme.t=setTimeout(()=>root.classList.remove('theme-animating'),450)}
 if(preset==='luxuryGold')root.removeAttribute('data-theme');else root.setAttribute('data-theme',preset);
 const s=root.style;
 for(const [k,v] of Object.entries(CSSVAR)){if(c.colors[k])s.setProperty(v,c.colors[k]);else s.removeProperty(v)}
 // الخلفية الثانوية ولون الكتابة على الأزرار تُشتق تلقائيًا عند تغيير الألوان
 if(c.colors.surface)s.setProperty('--surface2',mix(c.colors.surface,c.colors.text||PRESETS[preset].c.text,.06));else s.removeProperty('--surface2');
 if(c.colors.primary){s.setProperty('--on-primary',lum(c.colors.primary)>.35?'#141006':'#FFFFFF');if(!c.colors.primary2)s.setProperty('--primary-2',mix(c.colors.primary,'#FFFFFF',.4))}else{s.removeProperty('--on-primary');if(!c.colors.primary2)s.removeProperty('--primary-2')}
 const ar=c.fontAr==='system'?'"Segoe UI"':`"${c.fontAr}"`,en=c.fontEn==='system'?'system-ui':`"${c.fontEn}"`;
 s.setProperty('--font-ar',ar);s.setProperty('--font-en',en);
 if(c.headingFont){s.setProperty('--font-heading-family',`"${c.headingFont}"`);loadFont(c.headingFont)}else s.removeProperty('--font-heading-family');
 loadFont(c.fontAr);loadFont(c.fontEn);
 const size=c.fontSize==='custom'?Math.min(24,Math.max(12,Number(c.customSize)||15)):FONT_SIZES[c.fontSize]||15;
 s.setProperty('--font-size',size+'px');
 s.setProperty('--font-weight',String(c.fontWeight||400));
 s.setProperty('--heading-weight',String(Math.min(900,Math.max(600,(Number(c.fontWeight)||400)+300))));
 s.setProperty('--radius',Math.max(0,Math.min(28,Number(c.radius)))+'px');
 s.setProperty('--density',String(DENSITY[c.density]||1));
 root.dataset.density=c.density;
 root.dataset.effects=c.effects?'on':'off';
 document.querySelector('meta[name=theme-color]')?.setAttribute('content',c.colors.bg||PRESETS[preset].meta);
 current=c;
 listeners.forEach(fn=>{try{fn(c)}catch{}});
 return c;
}
/** يطبّق فورًا ويحفظ */
export function setTheme(patch,{save=true}={}){
 const base=getConfig();
 const next=normalize({...base,...patch,colors:patch.colors?{...patch.colors}:base.colors});
 applyTheme(next);if(save)prefs.set(KEY,next);return next;
}
export function resetTheme(){applyTheme(normalize(null));prefs.set(KEY,normalize(null));return getConfig()}

// ---- الثيمات المخصصة ----
export const customThemes=()=>prefs.get(CUSTOM,[])||[];
export async function saveCustomTheme(name,cfg=getConfig(),id=null){
 const list=customThemes().slice();const nm=String(name||'').trim();if(!nm)throw Error('اكتب اسمًا للثيم.');
 const cid=id||list.find(x=>x.name===nm)?.id||'th-'+Date.now().toString(36);
 const entry={id:cid,name:nm,config:{...clone(cfg),customId:null},updatedAt:new Date().toISOString()};
 const i=list.findIndex(x=>x.id===cid);if(i>=0)list[i]=entry;else list.push(entry);
 await prefs.set(CUSTOM,list);setTheme({customId:cid});return entry;
}
export function applyCustomTheme(id){const t=customThemes().find(x=>x.id===id);if(t)return setTheme({...t.config,customId:id})}
export async function deleteCustomTheme(id){await prefs.set(CUSTOM,customThemes().filter(x=>x.id!==id));if(getConfig().customId===id)setTheme({customId:null})}
export function exportThemeJSON(cfg=getConfig()){return JSON.stringify({type:'akl-theme',version:1,config:{...cfg,customId:null}},null,2)}
export function importThemeJSON(text){const x=JSON.parse(text);if(x?.type!=='akl-theme'||!x.config)throw Error('الملف ليس ثيمًا صالحًا.');return setTheme({...normalize(x.config),customId:null})}

/** يُستدعى مرة عند الإقلاع */
export async function initTheme(){
 applyTheme(getConfig(),{animate:false});
 await prefs.init();
 current=null;applyTheme(getConfig(),{animate:false});
 matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',()=>{if(getConfig().followSystem)applyTheme(getConfig())});
}
