import {uid} from '../core/id.js';
import {AppError,ERR} from '../core/errors.js';
export class DatabaseContext{
  constructor(db,profile){this.db=db;this.profile={...profile};this.token=uid();this.openedAt=new Date().toISOString();this.closed=false}
  assert(){if(this.closed||!this.db||this.db.readyState==='done')throw new AppError(ERR.STALE,'سياق قاعدة البيانات لم يعد نشطًا.')}
  isCurrent(profileId,token){return !this.closed&&this.profile.id===profileId&&this.token===token}
  close(){if(this.closed)return;this.closed=true;try{this.db.close()}catch{}}
}
