import type { Guild } from 'discord.js';
import type { Store } from '../core/db.js';
import type { Config } from '../core/config.js';
import { OWNER_ID } from '../core/config.js';
import { box,payload,colors } from '../core/ui.js';
import type { Reviews } from './reviews.js';
import type { Logs } from './logs.js';
export function statisticsError(stage:string,error:unknown) {
 const code=(error as {code?:string|number})?.code;
 const hint=code==='GuildMembersTimeout'?'Discord не прислал полный состав участников вовремя. Проверьте Server Members Intent.':
  code===50013?'Discord отказал в правах. Проверьте доступ бота и Manage Channels.':
  code===50001?'Discord отказал в доступе к каналу. Проверьте разрешения бота.':
  code===10003?'Канал удалён. Повторите !shop-setup для восстановления.':
  'Не удалось завершить запрос. Бот повторит проверку автоматически.';
 return `Шаг «${stage}»${code?` (код ${code})`:''}: ${hint}`;
}
export class Statistics {
 busy=false;
 constructor(readonly db:Store,readonly config:()=>Config,readonly reviews:Reviews,readonly logs:Logs,readonly now:()=>number=Date.now) {}
 async update(g:Guild,force=false) {
  // Startup and the periodic worker can run while setup is still creating channels.
  // An absent prerequisite is expected here and must not send a false permissions alert.
  if(this.busy||['statsMembers','statsReviews','reviews'].some(key=>!this.db.id('channels.'+key)))return;
  const c=this.config(),state=this.db.value<any>('statistics',{}),interval=c.statistics.intervalMinutes*60000;
  if(!force&&(this.now()<(state.nextAttemptAt??0)||this.now()-(state.checkedAt??0)<interval))return;
  this.busy=true;
  let stage='получение полного состава участников';
  try {
   Object.assign(state,{attemptedAt:this.now(),nextAttemptAt:this.now()+interval});this.db.set('statistics',state);
   const members=await g.members.fetch();
   stage='проверка опубликованных отзывов';await this.reviews.reconcile(g);
   const humans=[...members.values()].filter(m=>c.statistics.includeBots||!m.user.bot).length;
   const reviews=this.reviews.count();
   for(const [key,value] of [['statsMembers',humans],['statsReviews',reviews]] as const) {
    stage=key==='statsMembers'?'обновление канала участников':'обновление канала отзывов';
    const channel=await g.channels.fetch(this.db.id('channels.'+key)!);
    if(!channel)throw Object.assign(new Error('Missing statistics channel'),{code:10003});
    const spec=c.structure.channels.find(x=>x.key===key);
    if(!spec)throw new Error('Missing statistics channel configuration');
    const name=spec.name.replace(/(?:N|—|\d+)$/,String(value));
    if(channel.name!==name&&(state[key+'At']===undefined||this.now()-state[key+'At']>=interval)) {
     await channel.setName(name);state[key+'At']=this.now();this.db.set('statistics',state);
    }
   }
   Object.assign(state,{members:humans,reviews,checkedAt:this.now(),lastError:null,lastErrorStage:null,lastErrorCode:null});this.db.set('statistics',state);
  }catch(e){
   Object.assign(state,{lastError:statisticsError(stage,e),lastErrorStage:stage,lastErrorCode:(e as {code?:number|string})?.code??null});this.db.set('statistics',state);this.logs.error(e,'statistics: '+stage);
   if(state.errorReportedAt===undefined||this.now()-state.errorReportedAt>=3600000) {
    state.errorReportedAt=this.now();this.db.set('statistics',state);
    try {const owner=await g.client.users.fetch(OWNER_ID);await owner.send(payload(box([`## ⚠️ Статистика не обновлена\n${state.lastError}\n\nПоследние проверенные значения сохранены.\nСледующая попытка: **через ${c.statistics.intervalMinutes} минут**.\n\n-# Проверьте Guild Members Intent и права бота на каналы статистики и отзывов.`],colors.warning)));}catch{}
   }
  }finally{this.busy=false;}
 }
}
