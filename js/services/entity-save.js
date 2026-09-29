// نقطة حفظ موحّدة للنماذج: توجّه كل كيان إلى خدمته الأصلية (Services → Repositories) ولا تكتب مباشرة.
import {AppError,ERR} from '../core/errors.js';
import {saveOperational} from './operations.js';
import {saveJudicial} from './judicial.js';
import {saveFee,addFeePayment} from './finance.js';
import {savePoa} from './lifecycle.js';
import {saveGeneric} from './generic.js';
import {createLegalFile,saveParty,removeParty,saveRelation,refreshFileSearchText} from './legal-files.js';
import {opponentData} from '../domain/normalizers.js';
import {saveServiceRecord,saveBailiff} from './service-records.js';

const OPERATIONAL=['hearings','procedures','appointments','communications','caseNotes'];
const JUDICIAL=['witnesses','expertReports','judgments','execution'];

export async function saveEntity(office,store,data,id=null,expectedVersion=null){
 let row;
 switch(store){
  case 'clients':row=await office.saveClient(data,id,expectedVersion);await refreshPersonFiles(office,'clientId',row.id);break;
  case 'opponents':{if(!String(data.name||'').trim())throw new AppError(ERR.VALIDATION,'اسم الخصم مطلوب.',{name:'اسم الخصم مطلوب'});row=await saveGeneric(office,'opponents',opponentData(data),id);await refreshPersonFiles(office,'opponentId',row.id);break}
  case 'files':row=id?await office.saveFile(data,id,expectedVersion):await createLegalFile(office,data);if(id)await refreshFileSearchText(office,row.id);break;
  case 'cases':{
   if(!data.fileId)throw new AppError(ERR.VALIDATION,'يجب اختيار الملف.',{fileId:'الملف مطلوب'});
   row=id?await office.saveCase(data,id,expectedVersion):await office.createCase(data,[]);
   await refreshFileSearchText(office,row.fileId);break;}
  case 'serviceRecords':row=await saveServiceRecord(office,data,id);break;
  case 'bailiffs':row=await saveBailiff(office,data,id);break;
  case 'powersOfAttorney':row=await savePoa(office,data,id);break;
  case 'fees':row=await saveFee(office,data,id);break;
  case 'feePayments':row=id?await saveGeneric(office,'feePayments',{...data,amount:Number(data.amount||0)},id):await addFeePayment(office,data);break;
  case 'documentReferences':if(!data.fileId)throw new AppError(ERR.VALIDATION,'يجب اختيار الملف.',{fileId:'الملف مطلوب'});row=await saveGeneric(office,store,data,id);break;
  case 'fileParties':row=await saveParty(office,data,id);break;
  case 'fileRelations':row=await saveRelation(office,data,id);break;
  default:
   if(OPERATIONAL.includes(store))row=await saveOperational(office,store,data,id);
   else if(JUDICIAL.includes(store)){if(!data.caseId)throw new AppError(ERR.VALIDATION,'يجب اختيار القضية / المرحلة.',{caseId:'مطلوب'});row=await saveJudicial(office,store,data,id)}
   else throw new AppError(ERR.VALIDATION,'نوع السجل غير مدعوم في النماذج.');
 }
 return row;
}

// تغيّر اسم/هاتف الشخص ينعكس على أسماء الأطراف ونص البحث في ملفاته (بحد أقصى معقول).
async function refreshPersonFiles(office,key,personId){
 const parties=await office.r.fileParties.byIndex(key,personId,300);
 if(!parties.length)return;
 const person=key==='clientId'?await office.r.clients.get(personId):await office.r.opponents.get(personId);
 const name=key==='clientId'?person?.fullName:person?.name;
 const phone=(Array.isArray(person?.phones)&&person.phones[0])||person?.phone||'';
 const fileIds=new Set();
 for(const p of parties){if(p.name!==name||p.phone!==phone){p.name=name;p.phone=phone;await office.r.fileParties.put(p)}fileIds.add(p.fileId)}
 for(const f of fileIds)await refreshFileSearchText(office,f);
}

// حذف منطقي عبر خدمة Office (يحترم قاعدة منع حذف ملف له قضايا).
export async function deleteEntity(office,store,id){
 if(store==='fileParties')return removeParty(office,id);
 const row=await office.r[store].get(id);
 const out=await office.softDelete(store,id,row?.version??null);
 if(store==='cases'&&row?.fileId)await refreshFileSearchText(office,row.fileId);
 return out;
}
