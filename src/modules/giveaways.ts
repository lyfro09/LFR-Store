import { ButtonStyle, type Guild, type GuildMember } from 'discord.js';
import { Store, Serial, UserError, requireValue } from '../core/db.js';
import { authorize } from '../core/auth.js';
import { box,payload,row,button,safeText,colors } from '../core/ui.js';
import type { Logs } from './logs.js';
import { panelMarker,findMarkedMessage } from './panels.js';
export function parseGiveawayUrl(url:string) {const m=/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(url.trim());if(!m)throw new UserError('Введите ссылку на сообщение Discord: https://discord.com/channels/сервер/канал/сообщение');return {guild:m[1],channel:m[2],message:m[3],url:`https://discord.com/channels/${m[1]}/${m[2]}/${m[3]}`};}
export class Giveaways {
 readonly serial=new Serial();
 constructor(readonly db:Store,readonly logs:Logs) {}
 async submit(g:Guild,user:string,url:string) {
  const p=parseGiveawayUrl(url);
  return this.serial.run(user+':'+p.message,async()=>{
   let r=this.db.get('SELECT * FROM giveaways WHERE user_id=? AND message_id=?',user,p.message);
   if(!r){
    let verified=false;
    try{const channel=await g.client.channels.fetch(p.channel);if(channel?.isTextBased()&&'guildId' in channel&&channel.guildId===p.guild)verified=!!await channel.messages.fetch(p.message);}catch{}
    const id=Number(this.db.run('INSERT INTO giveaways(user_id,message_id,url,created,data) VALUES (?,?,?,?,?)',user,p.message,p.url,Date.now(),JSON.stringify({verified})).lastInsertRowid);
    r=this.db.get('SELECT * FROM giveaways WHERE id=?',id)!;
   }
   await this.publish(g,Number(r.id));return r;
  });
 }
 async publish(g:Guild,id:number) {
  const r=requireValue(this.db.get('SELECT * FROM giveaways WHERE id=?',id),'Заявка не найдена.');const data=JSON.parse(r.data),channel=await this.logs.channel(g,'giveawayLog');
  const status=({pending:'🟡 На проверке',approved:'🟢 Участие одобрено',rejected:'🔴 Отклонено'} as Record<string,string>)[r.status],accent=r.status==='approved'?colors.success:r.status==='rejected'?colors.danger:colors.warning;
  const b=box([`## 🎁 Заявка на розыгрыш · #${id}\n-# Проверка участия сотрудником магазина`,`### 👤 Участник\n<@${r.user_id}>\n\nСтатус: **${status}**\nДоступность сообщения: ${data.verified?'🟢 подтверждена':'🟡 требуется ручная проверка'}`,`### 🔗 Сообщение участника\n[Открыть сообщение в Discord](${r.url})${data.reason?'\n\n**Причина решения:** '+safeText(data.reason):''}\n\n-# Одобрение участия не означает победу.`],accent).setId(panelMarker('giveaway:'+id));
  if(r.status==='pending')b.addActionRowComponents(row(button(`giveaway:approved:${id}`,'Одобрить',ButtonStyle.Success),button(`giveaway:rejected:${id}`,'Отклонить',ButtonStyle.Danger)));
  let m;if(r.review_message_id)try{m=await channel.messages.fetch(r.review_message_id);}catch(e){if((e as {code?:number}).code!==10008)throw e;}
  if(!m)m=await findMarkedMessage(channel,g.client.user.id,panelMarker('giveaway:'+id));
  if(m)await m.edit({...payload(b),flags:32768});else m=await channel.send(payload(b));
  this.db.run('UPDATE giveaways SET review_message_id=? WHERE id=?',m.id,id);
 }
 async decide(g:Guild,m:GuildMember,id:number,status:'approved'|'rejected',reason='') {
  authorize(this.db,m,'staff');if(status==='rejected'&&!reason.trim())throw new UserError('Нужна причина отклонения.');
  this.db.tx(()=>{const r=requireValue(this.db.get('SELECT * FROM giveaways WHERE id=?',id),'Заявка не найдена.');if(r.status!=='pending')throw new UserError('Заявка уже обработана.');const data={...JSON.parse(r.data),reason,actor:m.id};this.db.run('UPDATE giveaways SET status=?,data=? WHERE id=? AND status=\'pending\'',status,JSON.stringify(data),id);this.db.audit('giveaway:'+id,m.id,status,{reason});this.db.enqueue('giveawayResult',{id,user:r.user_id,status,reason});});
  await this.publish(g,id);
 }
}
