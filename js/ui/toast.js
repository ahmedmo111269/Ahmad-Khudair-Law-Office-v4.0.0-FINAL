export function toast(msg,type='ok'){const e=document.createElement('div');e.className='toast '+type;e.textContent=msg;document.body.append(e);setTimeout(()=>e.remove(),2800)}
