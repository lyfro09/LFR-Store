import { AttachmentBuilder, FileBuilder, ContainerBuilder, type Guild, type TextChannel } from 'discord.js';
import type { Store } from '../core/db.js';
import { payload,box,safeText } from '../core/ui.js';
export type LogEvent={title:string;description?:string;fields?:Array<{name:string;value:string}>;color?:number;timestamp?:number};
const styles:Record<string,{emoji:string;title:string;color:number}>={
 techLog:{emoji:'🛡️',title:'Техническое событие',color:0xed4245},giveawayLog:{emoji:'🎁',title:'Розыгрыш',color:0xf1c40f},freebieLog:{emoji:'🎉',title:'Халява',color:0x57f287},joinLog:{emoji:'👥',title:'Участники',color:0x5865f2},ticketLog:{emoji:'🎫',title:'Тикеты',color:0x5865f2},recruitLog:{emoji:'📋',title:'Набор',color:0x57f287},roleLog:{emoji:'🪪',title:'Роли',color:0x9b59b6},messageLog:{emoji:'💬',title:'Сообщения',color:0xfee75c}
};
export class Logs {
 constructor(readonly db:Store) {}
 async channel(guild:Guild,key:string):Promise<TextChannel> { const id=this.db.id('channels.'+key);if(!id)throw new Error('Не настроен журнал '+key);const c=await guild.channels.fetch(id);if(!c?.isTextBased()||c.isThread())throw new Error('Недоступен журнал '+key);return c as TextChannel; }
 async send(guild:Guild,key:string,event:string|LogEvent) {
  const c=await this.channel(guild,key),style=styles[key]??{emoji:'📄',title:'Событие',color:0x5865f2},entry=typeof event==='string'?{title:style.title,description:event}:event;
  const body=[entry.description,...(entry.fields??[]).map(f=>`**${safeText(f.name)}**\n${f.value}`)].filter(Boolean).join('\n\n').slice(0,3500);
  const timestamp=Math.floor((entry.timestamp??Date.now())/1000),b=box([`## ${style.emoji} ${safeText(entry.title)}`,body,`-# <t:${timestamp}:F> · <t:${timestamp}:R>`],entry.color??style.color);return c.send(payload(b));
 }
 queue(key:string,event:string|LogEvent) {this.db.enqueue('log',{key,event});}
 error(error:unknown,context:string) {
  // Never serialize Discord request bodies, interaction tokens or customer text.
  const code=(error as {code?:number|string})?.code;
  console.error(`[${context}] ${error instanceof Error?error.name:'Error'}${code?' code='+code:''}`);
  this.queue('techLog',{title:'Ошибка бота',description:'Операция завершилась с ошибкой. Секреты и содержимое запроса в журнал не выводятся.',fields:[{name:'Участок',value:`\`${safeText(context)}\``},{name:'Тип ошибки',value:`\`${safeText(error instanceof Error?error.name:'Error')}\`${code?` · код \`${safeText(String(code))}\``:''}`}]});
 }
 async archive(guild:Guild,channel:TextChannel,ticket:number) {
  const log=await this.channel(guild,'ticketLog');
  const lines=[`Тикет #${ticket}; канал ${channel.id}; архив ${new Date().toISOString()}`, 'Вложения: сохранены только ссылки, они могут истечь. Удалённые сообщения и недоступное содержимое не восстанавливаются.'];
  if(!guild.client.options.intents.has('MessageContent'))lines.push('ВНИМАНИЕ: Message Content Intent отключён; архив может не содержать текст сообщений.');
  let before:string|undefined; const chunks:string[][]=[];
  for(;;){ const batch=await channel.messages.fetch({limit:100,...(before?{before}:{})});
   const part=[...batch.values()].reverse().map(m=>`[${m.createdAt.toISOString()}] ${m.author.tag} (${m.author.id}) [${m.id}]\n${m.content || '[Текст отсутствует или недоступен]'}\n${m.components.length?'Компоненты: '+JSON.stringify(m.components.map(x=>x.toJSON()))+'\n':''}${m.attachments.map(a=>`Вложение (только ссылка): ${a.name} ${a.url}`).join('\n')}`);
   chunks.unshift(part);if(batch.size<100)break;before=batch.last()!.id;
  }
  const full=lines.concat(chunks.flat()).join('\n\n');
  // Each piece stays below Discord's default attachment limit even with UTF-8 Cyrillic.
  const pieces=full.match(/[\s\S]{1,1000000}/gu)??['Пустая переписка'];const urls:string[]=[];
  for(let i=0;i<pieces.length;i++) {
   const name=`ticket-${ticket}-${Date.now()}-${i+1}.txt`;
   const b=box([`## 📦 Архив тикета #${String(ticket).padStart(6,'0')}`,`Канал: **${safeText(channel.name)}**\nЧасть архива: **${i+1}/${pieces.length}**`,`-# <t:${Math.floor(Date.now()/1000)}:F>`],styles.ticketLog.color).addFileComponents(new FileBuilder().setURL('attachment://'+name));
   const sent=await log.send({...payload(b),files:[new AttachmentBuilder(Buffer.from(pieces[i],'utf8'),{name})]}); urls.push(sent.url);
  }
  this.db.audit('ticket:'+ticket,'bot','archive',{urls,attachments:'links-only'});return urls;
 }
}
