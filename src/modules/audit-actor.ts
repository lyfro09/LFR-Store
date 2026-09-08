import { type AuditLogEvent, type Guild } from 'discord.js';
import { safeText } from '../core/ui.js';

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Audit entries can arrive shortly after their gateway event, so retry briefly. */
export async function auditActor(guild:Guild,type:AuditLogEvent,targetId:string) {
 for(const delay of [250,750,1500]) {
  await wait(delay);
  try {
   const audit=await guild.fetchAuditLogs({type,limit:25});
   const entry=audit.entries.find(x=>x.targetId===targetId&&Date.now()-x.createdTimestamp<30_000);
   if(entry?.executorId)return `<@${entry.executorId}>${entry.executor?.tag?` · ${safeText(entry.executor.tag)}`:''}`;
  } catch {return 'Не удалось определить — проверьте право «Просмотр журнала аудита» у бота.';}
 }
 return 'Не удалось определить: запись ещё не появилась в аудите Discord.';
}
