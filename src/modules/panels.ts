import { ContainerBuilder, ButtonStyle, type Guild, type MessageCreateOptions, type TextChannel } from 'discord.js';
import { createHash } from 'node:crypto';
import type { Store } from '../core/db.js';
import { Serial } from '../core/db.js';
import { type Config, variables, template } from '../core/config.js';
import { banner, text, separator, row, button, payload, menu } from '../core/ui.js';
export function panelMarker(key:string) { return (createHash('sha256').update('lfr-panel:'+key).digest().readUInt32BE(0) & 0x7fffffff)||1; }
export function buildPanel(key:string,c:Config,db:Store) {
 const vars=variables(c,db),t=(s:string)=>template(s,vars);
 const container=new ContainerBuilder().setAccentColor(parseInt(c.appearance.accent.slice(1),16)).setId(panelMarker(key));
 const path=c.appearance.banners[key as keyof Config['appearance']['banners']];
 const files=path?banner(container,path,key):[];
 const add=(s:string,split=true)=>{if(split&&container.components.length)container.addSeparatorComponents(separator());container.addTextDisplayComponents(text(t(s)));};
 if(key==='information') {
  const i=c.information; add(i.welcome);add(i.order);add(i.guarantees);add(i.safety);
  add([i.contactsTitle,'',i.seller,c.PARTNERSHIP_CONTACT?i.partnership:'',c.DISCORD_URL?i.discord:'',c.TELEGRAM_URL?i.telegram:''].filter((s,index)=>s||index===1).join('\n'));
  add([i.why,c.START_YEAR?i.year:'',i.support].filter(Boolean).join('\n'));add(i.thanks);
 } else if(key==='rules') {
  add(c.rules.title+'\n\n'+c.rules.intro);
  c.rules.items.forEach((s,index)=>add(template(c.rules.itemTitle,{NUMBER:String(index+1)})+'\n'+s.split('\n').map(x=>'> '+x).join('\n')));
 } else {
  add(c.texts[key]??'## '+c.SHOP_NAME);
  if(key==='products') {
   const categories=db.all('SELECT data FROM categories').map(r=>JSON.parse(r.data)).filter(c=>c.enabled).sort((a,b)=>a.position-b.position);
   if(categories.length)container.addSeparatorComponents(separator()).addActionRowComponents(menu('category:view','Выберите категорию',categories.slice(0,25).map(c=>({label:c.name,value:c.id,description:c.description,...(c.emoji?{emoji:c.emoji}:{})}))));
   else container.addSeparatorComponents(separator()).addTextDisplayComponents(text('### 💤 Каталог пока пуст\nТовары появятся здесь после добавления ассортимента.'));
   if(categories.length>25)container.addActionRowComponents(row(button('categories:view:1','Другие категории')));
  }
  if(key==='tickets')container.addSeparatorComponents(separator()).addActionRowComponents(row(button('checkout','🛒 Оформить заказ',ButtonStyle.Primary),button('browse','📦 Открыть каталог')),row(button('giveaway','🎁 Получить выигрыш',ButtonStyle.Success)));
  if(key==='support')container.addSeparatorComponents(separator()).addActionRowComponents(row(button('support','💬 Задать вопрос',ButtonStyle.Primary)));
 }
 return {...payload(container),files};
}
export async function findMarkedMessage(channel:TextChannel,botId:string,marker:number) {
 let before:string|undefined;
 for(;;) {
  const batch=await channel.messages.fetch({limit:100,...(before?{before}:{})});
  for(const m of batch.values())if(m.author.id===botId&&m.components.some(c=>c.toJSON().id===marker))return m;
  if(batch.size<100)return undefined; before=batch.last()!.id;
 }
}
export class Panels {
 readonly serial=new Serial();
 constructor(readonly db:Store,readonly config:()=>Config) {}
 keys() { return ['information','rules','products','tickets','support','reviews','chat','offtopic','news','giveaways','freebies','cases','techLog','giveawayLog','freebieLog','joinLog','ticketLog','recruitLog','roleLog','messageLog','moderator']; }
 async publish(guild:Guild,key:string) {
  if(!this.keys().includes(key))throw new Error('Неизвестная панель');
  return this.serial.run(key,async()=>{
   const channelId=this.db.id('channels.'+(key==='support'?'tickets':key));
   if(!channelId)throw new Error('Не настроен канал панели '+key);
   const raw=await guild.channels.fetch(channelId);if(!raw?.isTextBased()||raw.isThread())throw new Error('Канал панели недоступен: '+key);const channel=raw as TextChannel;
   const data=buildPanel(key,this.config(),this.db);
   let old=this.db.get('SELECT * FROM panels WHERE key=?',key);
   if(old&&old.channel_id!==channel.id) {
    let previousChannel;
    try {previousChannel=await guild.channels.fetch(old.channel_id);}catch(e){if((e as {code?:number}).code!==10003)throw e;}
    if(previousChannel)throw new Error('Прежний канал панели ещё существует. Проверьте bindings: автоматический перенос мог бы создать две копии панели.');
    // The old channel is confirmed deleted, so its message cannot be recovered.
    // Forget only that stale message pointer; the new channel is already configured.
    this.db.run('UPDATE panels SET channel_id=?,message_id=NULL WHERE key=? AND channel_id=?',channel.id,key,old.channel_id);
    this.db.audit('panel:'+key,'bot','deletedChannelRebound',{previousChannel:old.channel_id,channel:channel.id});
    old=this.db.get('SELECT * FROM panels WHERE key=?',key);
   }
   let message;
   if(old?.message_id)try{message=await channel.messages.fetch(old.message_id);}catch(e){if((e as {code?:number}).code!==10008)throw e;}
   if(!message)message=await findMarkedMessage(channel,guild.client.user.id,panelMarker(key));
   if(message&&message.author.id!==guild.client.user.id)throw new Error('ID панели указывает на чужое сообщение.');
   this.db.run('INSERT INTO panels(key,channel_id) VALUES (?,?) ON CONFLICT(key) DO NOTHING',key,channel.id);
   if(message)await message.edit({...data,attachments:[],flags:32768});else message=await channel.send(data);
   this.db.run('UPDATE panels SET message_id=? WHERE key=?',message.id,key);
   if(!message.pinned)await message.pin();
   return message.id;
  });
 }
 async all(guild:Guild) { const result:string[]=[]; for(const key of this.keys()){await this.publish(guild,key); result.push(key);}return result; }
}
