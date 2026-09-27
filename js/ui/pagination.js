export function pager(state={}){
 const page=Number(state.page||1),hasNext=Boolean(state.hasNext),hasPrev=Boolean(state.hasPrev&&page>1);
 return `<div class="pager"><button class="ghost" data-pager-prev ${hasPrev?'':'disabled'}>السابق</button><span>صفحة ${page}</span><button class="ghost" data-pager-next ${hasNext?'':'disabled'}>التالي</button></div>`;
}
export function bindPager(root,onPrev,onNext){
 root?.querySelector('[data-pager-prev]')?.addEventListener('click',()=>onPrev?.());
 root?.querySelector('[data-pager-next]')?.addEventListener('click',()=>onNext?.());
}

/*
 * Cursor-stack paging state shared by all list pages.
 * state.cursors[n-1] is the cursor used to load page n (page 1 => null).
 */
export function pagingState(state={},defaults={}){
 const s=Object.assign({page:1,cursors:[null],nextCursor:null,hasNext:false,hasPrev:false},defaults,state);
 if(!Array.isArray(s.cursors)||!s.cursors.length)s.cursors=[null];
 if(s.page<1)s.page=1;
 if(s.cursors.length<s.page){s.page=1;s.cursors=[null]}
 return s;
}
export function currentCursor(s){return s.cursors?.[s.page-1]??null}
export function applyPageResult(s,r){s.nextCursor=r.nextCursor||null;s.hasNext=Boolean(r.hasMore&&r.nextCursor);s.hasPrev=s.page>1;return s}
export function nextPage(s){if(!s?.hasNext||!s.nextCursor)return false;s.cursors=[...(s.cursors||[null]).slice(0,s.page),s.nextCursor];s.page++;return true}
export function prevPage(s){if(!s||s.page<=1)return false;s.page--;s.cursors=(s.cursors||[null]).slice(0,s.page);return true}
export function resetPaging(s){if(!s)return s;s.page=1;s.cursors=[null];s.nextCursor=null;s.hasNext=false;s.hasPrev=false;return s}
