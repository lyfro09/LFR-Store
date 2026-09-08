import { randomUUID } from 'node:crypto';
import { Store, UserError, requireValue } from '../core/db.js';
import type { Config } from '../core/config.js';
import type { Quote } from './catalog.js';
export type Session={catalogEdit?:{kind:'product'|'category',id:string,original:string},product?:string,variant?:string,variantGroup?:string,mode?:'view'|'order',quote?:Quote,comment?:string,cancelled?:boolean};
export class Orders {
 constructor(readonly db:Store) {}
 session(user:string,minutes:number,data:Session={}) { const id=randomUUID(); this.db.run('INSERT INTO sessions VALUES (?,?,?,?)',id,user,Date.now()+minutes*60000,JSON.stringify(data)); return id; }
 readSession(id:string,user:string) { const s=requireValue(this.db.get('SELECT * FROM sessions WHERE id=? AND user_id=?',id,user),'Сессия не найдена. Начните заказ заново.'); if(s.expires<Date.now()||JSON.parse(s.data).cancelled)throw new UserError('Сессия истекла или отменена. Начните заказ заново.'); return JSON.parse(s.data) as Session; }
 saveSession(id:string,data:Session) { this.db.run('UPDATE sessions SET data=? WHERE id=?',JSON.stringify(data),id); }
 active(user:string,kind:string,subtype='') { const rows=this.db.all('SELECT * FROM tickets WHERE user_id=? AND kind=? AND state IN (\'open\',\'creating\') ORDER BY id',user,kind);return kind==='support'?rows.filter(t=>(JSON.parse(t.data).type??'')===subtype):rows; }
 reserve(user:string,kind:'purchase'|'support',cfg:Config,data:unknown,session?:string,quote?:Quote) {
  return this.db.tx(()=>{
   if(session) { const old=this.db.get('SELECT ticket_id FROM orders WHERE session_id=?',session); if(old)return {id:Number(old.ticket_id),existing:true}; }
   const subtype=kind==='support'&&data&&typeof data==='object'&&'type' in data?String((data as {type?:unknown}).type??''):'';
   const active=this.active(user,kind,subtype); if(active.length>=cfg.tickets.activePerType)return {id:Number(active[0].id),existing:true};
   const last=this.db.get('SELECT created FROM tickets WHERE user_id=? ORDER BY created DESC LIMIT 1',user);
   if(last && Date.now()-last.created<cfg.tickets.cooldownSeconds*1000)throw new UserError('Подождите перед созданием следующего тикета.');
   const id=Number(this.db.run('INSERT INTO tickets(user_id,kind,state,created,data) VALUES (?,?,\'creating\',?,?)',user,kind,Date.now(),JSON.stringify(data)).lastInsertRowid);
   if(session&&quote)this.db.run('INSERT INTO orders(session_id,user_id,ticket_id,created,data) VALUES (?,?,?,?,?)',session,user,id,Date.now(),JSON.stringify(quote));
   this.db.audit('ticket:'+id,user,'created'); return {id,existing:false};
  });
 }
 claim(id:number,actor:string) { const n=this.db.run('UPDATE tickets SET assignee=? WHERE id=? AND assignee IS NULL AND state=\'open\'',actor,id); if(!n.changes)throw new UserError('Тикет уже принят другим сотрудником или закрыт.'); this.db.audit('ticket:'+id,actor,'claimed'); }
 transition(ticket:number,actor:string,target:string,reason='',settlement='') {
  return this.db.tx(()=>{
   const o=requireValue(this.db.get('SELECT * FROM orders WHERE ticket_id=?',ticket),'Заказ не найден.');
   const t=requireValue(this.db.get('SELECT state FROM tickets WHERE id=?',ticket),'Тикет не найден.'); if(t.state!=='open')throw new UserError('Сначала откройте тикет.');
   const transitions:Record<string,string[]>={pending:['paid','cancelled'],paid:['working','cancelled'],working:['completed','cancelled'],completed:[],cancelled:[]};
   if(!(transitions[o.status]??[]).includes(target))throw new UserError('Этот переход статуса уже выполнен или недопустим.');
   if(target==='cancelled'&&(!reason.trim()||(o.status!=='pending'&&!settlement.trim())))throw new UserError('Укажите причину и результат ручного урегулирования оплаты.');
   this.db.run('UPDATE orders SET status=? WHERE id=? AND status=?',target,o.id,o.status);
   if(target==='completed'){const q=JSON.parse(o.data) as Quote;this.db.run('INSERT OR IGNORE INTO spend VALUES (?,?,?,?)',o.id,o.user_id,q.total,q.currency);}
   this.db.audit('order:'+o.id,actor,target,{reason,settlement});
   this.db.enqueue('orderStatus',{ticket,target,user:o.user_id});return o;
  });
 }
}
export const statusNames:Record<string,string>={pending:'Ожидает оплаты',paid:'Оплачен',working:'В работе',completed:'Выполнен',cancelled:'Отменён'};
