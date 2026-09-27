import {transaction,request} from '../db/unit-of-work.js';
import {assertExpectedVersion} from '../services/consistency.js';

function openTestDB(name){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('a',{keyPath:'id'});r.result.createObjectStore('b',{keyPath:'id'})};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)})}
function get(db,store,id){return new Promise((resolve,reject)=>{const r=db.transaction(store,'readonly').objectStore(store).get(id);r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)})}
export async function runTransactionTests(test,expect){
 const name=`AhmadKhudairLawOfficeDB__test__tx__${Date.now()}_${Math.random().toString(36).slice(2)}`;
 const db=await openTestDB(name);
 try{
  let failed=false;
  try{await transaction({db,assert(){}},['a','b'],async tx=>{await request(tx.objectStore('a').put({id:'x',value:1}));await request(tx.objectStore('b').put({id:'y',value:2}));throw new Error('injected failure')})}catch(e){failed=true}
  test('transaction rollback on injected failure',async()=>{expect(failed).toBe(true);expect(await get(db,'a','x')).toBe(undefined);expect(await get(db,'b','y')).toBe(undefined)});
  test('optimistic concurrency accepts matching version',()=>expect(()=>assertExpectedVersion({version:3},3,'سجل')).not.toThrow());
  test('optimistic concurrency rejects stale version',()=>expect(()=>assertExpectedVersion({version:4},3,'سجل')).toThrow());
 }finally{db.close();try{indexedDB.deleteDatabase(name)}catch{}}
}
