import type { Store } from '../core/db.js';
export type OutboxJob = { id:number; kind:string; data:string };
/** A missing log channel is expected during setup, not a delivery error. */
export class Outbox {
 private busy=false;
 private retryAfter=new Map<string,number>();
 constructor(readonly db:Store,readonly now:()=>number=Date.now,readonly warn:(message:string)=>void=console.warn) {}
 async drain(deliver:(job:OutboxJob,data:any)=>Promise<void>) {
  if(this.busy)return;this.busy=true;
  try {
   let attempts=0;
   for(const job of this.db.all<OutboxJob>('SELECT id,kind,data FROM outbox ORDER BY id')) {
    const data=JSON.parse(job.data);
    if(job.kind==='log'&&!this.db.id('channels.'+data.key))continue;
    const destination=job.kind==='log'?'log:'+data.key:job.kind+':'+job.id;
    if((this.retryAfter.get(destination)??0)>this.now())continue;
    if(attempts++>=30)break;
    try {await deliver(job,data);this.db.run('DELETE FROM outbox WHERE id=?',job.id);this.retryAfter.delete(destination);}
    catch(e) {
     this.retryAfter.set(destination,this.now()+5*60_000);
     const code=(e as {code?:number|string}).code;
     this.warn(`Отправка ${destination} отложена на 5 минут${code ? ' (код Discord '+code+')' : ''}. Задание сохранено.`);
    }
   }
  } finally {this.busy=false;}
 }
}
