import {SCHEMA} from '../db/schema.js';

export function auditIndexes(db){
  const rows=[];
  for(const [store,def] of Object.entries(SCHEMA)){
    const exists=db.objectStoreNames.contains(store);
    if(!exists){rows.push({store,index:'*',status:'missing-store',keyPath:null});continue}
    const tx=db.transaction(store,'readonly');
    const os=tx.objectStore(store);
    for(const [name,keyPath] of Object.entries(def.indexes)){
      rows.push({store,index:name,status:os.indexNames.contains(name)?'ok':'missing',keyPath});
    }
  }
  return rows;
}
