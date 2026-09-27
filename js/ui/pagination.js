export function pager(state={}){
 const page=Number(state.page||1),hasNext=Boolean(state.hasNext),hasPrev=Boolean(state.hasPrev&&page>1);
 return `<div class="pager"><button class="ghost" data-pager-prev ${hasPrev?'':'disabled'}>السابق</button><span>صفحة ${page}</span><button class="ghost" data-pager-next ${hasNext?'':'disabled'}>التالي</button></div>`;
}
export function bindPager(root,onPrev,onNext){
 root?.querySelector('[data-pager-prev]')?.addEventListener('click',()=>onPrev?.());
 root?.querySelector('[data-pager-next]')?.addEventListener('click',()=>onNext?.());
}
