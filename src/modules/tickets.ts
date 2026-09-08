import { ChannelType, ButtonStyle, type Guild, type GuildMember, type TextChannel } from 'discord.js';
import type { Config } from '../core/config.js';
import { Store, Serial, UserError, requireValue } from '../core/db.js';
import { authorize, can, overwrites } from '../core/auth.js';
import { box,payload,button,row,safeText,money,noMentions,colors } from '../core/ui.js';
import { Orders,statusNames } from './orders.js';
import type { Quote } from './catalog.js';
import type { Logs } from './logs.js';
import { findMarkedMessage,panelMarker } from './panels.js';
export class Tickets {
 readonly serial=new Serial();
 constructor(readonly db:Store,readonly config:()=>Config,readonly orders:Orders,readonly logs:Logs) {}
 get(id:number) {return requireValue(this.db.get('SELECT * FROM tickets WHERE id=?',id),'Тикет не найден.');}
 async channel(g:Guild,id:number) {const t=this.get(id);if(!t.channel_id)throw new UserError('Канал ещё создаётся. Повторите действие.');const c=await g.channels.fetch(t.channel_id);if(!c||c.type!==ChannelType.GuildText)throw new UserError('Канал тикета удалён или недоступен.');return c;}
 access(m:GuildMember,id:number,staff=false) {const t=this.get(id);if(staff)authorize(this.db,m,'staff');else if(t.user_id!==m.id&&!can(this.db,m.id,m.roles.cache.keys(),'staff'))throw new UserError('Этот тикет вам недоступен.');return t;}
 async ensure(guild:Guild,id:number) {
  return this.serial.run('ticket:'+id,async()=>{
   let t=this.get(id);if(t.state==='deleted')throw new UserError('Тикет удалён.');
   const all=await guild.channels.fetch();let c=t.channel_id?all.get(t.channel_id):all.find(x=>x?.type===ChannelType.GuildText&&x.topic===`shop-ticket:${id}`);
   if(!c&&t.channel_id){this.db.run('UPDATE tickets SET state=\'deleted\' WHERE id=?',id);throw new UserError('Канал удалён вручную. Начните новый заказ.');}
   if(!c){
    const parent=requireValue(this.db.id('categories.tickets'),'Сначала выполните настройку сервера.');
    const member=await guild.members.fetch(t.user_id),ticketData=JSON.parse(t.data),name=member.user.username.toLowerCase().replace(/[^\p{L}\p{N}-]/gu,'-').slice(0,35)||'user';
    c=await guild.channels.create({name:`${t.kind==='purchase'?'⏳':ticketData.type==='giveaway-prize'?'🎁':'support'}-${name}-${String(id).padStart(6,'0')}`,type:ChannelType.GuildText,parent,topic:`shop-ticket:${id}`,permissionOverwrites:overwrites(this.db,guild.id,guild.client.user.id,'tickets',t.user_id),reason:'shop-ticket:'+id});
   }
   if(c.type!==ChannelType.GuildText)throw new Error('Неверный тип канала тикета');
   if(t.state==='creating')await c.edit({parent:requireValue(this.db.id('categories.tickets'),'Категория тикетов не настроена.'),permissionOverwrites:overwrites(this.db,guild.id,guild.client.user.id,'tickets',t.user_id,false,JSON.parse(t.data).extra??[])});
   this.db.run('UPDATE tickets SET channel_id=?,state=CASE WHEN state=\'creating\' THEN \'open\' ELSE state END WHERE id=?',c.id,id);
   await this.refresh(guild,id);
   t=this.get(id);const data=JSON.parse(t.data);
   if(!data.notified){
    // Persist first: a restart must never ping the role twice.
    data.notified=true;this.db.run('UPDATE tickets SET data=? WHERE id=?',JSON.stringify(data),id);
    const seller=this.db.id('roles.seller')!;
    await c.send({...payload(box([`## 🛎️ Новый тикет\n<@&${seller}>, покупатель <@${t.user_id}> ожидает ответа.\n\n-# Нажмите «Принять в работу» на карточке выше.`],colors.info)),allowedMentions:{parse:[],roles:[seller]}});
    this.logs.queue('ticketLog',{title:'Тикет создан',description:`<#${c.id}>`,color:0x57f287,fields:[{name:'Номер',value:`#${String(id).padStart(6,'0')}`},{name:'Автор',value:`<@${t.user_id}>`},{name:'Тип',value:t.kind==='purchase'?'Покупка':data.type==='giveaway-prize'?'Выдача выигрыша':'Поддержка'}]});
   }
   return c;
  });
 }
 async refresh(g:Guild,id:number) {
  const t=this.get(id),channel=await this.channel(g,id),data=JSON.parse(t.data),o=this.db.get('SELECT * FROM orders WHERE ticket_id=?',id);
  const giveaway=data.type==='giveaway-prize',ticketStatus=t.state==='closed'?'🔒 закрыт':'🟢 открыт',blocks=[`## ${t.kind==='purchase'?'🛒 Заказ':giveaway?'🎁 Выдача выигрыша':'💬 Поддержка'} · #${String(id).padStart(6,'0')}\n-# Приватный канал покупателя и команды магазина`,`### 👤 Участники\nПокупатель: <@${t.user_id}>\nОтветственный: ${t.assignee?`<@${t.assignee}>`:'**не назначен**'}\nСоздан: <t:${Math.floor(t.created/1000)}:f>\nСостояние: **${ticketStatus}**`];
  if(o){const q=JSON.parse(o.data) as Quote;blocks.push(`### 📦 ${safeText(q.name)}${q.variantName?' · '+safeText(q.variantName):''}\nСтатус заказа: **${statusNames[o.status]}**\nЦена: ${money(q.price,q.currency)}\nСкидка: **${q.discount}%** · −${money(q.discountAmount,q.currency)}\n## К оплате: ${money(q.total,q.currency)}\n\n🚚 ${q.deliveryKind==='usual'?'Обычное время выдачи':'Nitro и подписки'}: **${q.delivery}**${q.deliveryKind==='subscriptions'?'\n'+q.delay:''}\n📌 ${safeText(q.terms)}\n💬 Комментарий: **${safeText(data.comment||'не указан')}**`);blocks.push(`### 💳 Оплата\n${this.config().paymentInstructions||'Способ оплаты согласует продавец.'}\n\n-# Оплачивайте только после подтверждения суммы сотрудником магазина.`);}
  else if(giveaway)blocks.push(`### 🔗 Подтверждение выигрыша\nПроверьте сообщение и согласуйте способ выдачи с победителем.\n\n[Открыть сообщение о выигрыше](${data.giveawayUrl})`);
  else blocks.push(`### 📝 ${safeText(data.subject)}\n${safeText(data.description)}`);
  const accent=t.state==='closed'?colors.neutral:o?.status==='completed'?colors.success:o?.status==='cancelled'?colors.danger:giveaway?colors.success:colors.brand,b=box(blocks,accent).setId(panelMarker('ticket:'+id));
  b.addActionRowComponents(t.state==='closed'?row(button(`ticket:reopen:${id}`,'↗️ Открыть снова',ButtonStyle.Success),button(`ticket:delete:${id}`,'🗑️ Удалить',ButtonStyle.Danger),button(`ticket:archive:${id}`,'📄 Архив')):row(button(`ticket:claim:${id}`,'🙋 Принять',ButtonStyle.Primary,!!t.assignee),button(`ticket:close:${id}`,'🔒 Закрыть',ButtonStyle.Danger),button(`ticket:archive:${id}`,'📄 Архив')));
  if(o&&t.state==='open')b.addActionRowComponents(row(button(`order:paid:${id}`,'💳 Оплачено',ButtonStyle.Success,o.status!=='pending'),button(`order:working:${id}`,'⚙️ В работе',ButtonStyle.Primary,o.status!=='paid'),button(`order:completed:${id}`,'✅ Выдано',ButtonStyle.Success,o.status!=='working'),button(`order:cancelled:${id}`,'✖ Отмена',ButtonStyle.Danger,['completed','cancelled'].includes(o.status))));
  let m;if(t.message_id)try{m=await channel.messages.fetch(t.message_id);}catch(e){if((e as {code?:number}).code!==10008)throw e;}
  if(!m)m=await findMarkedMessage(channel,g.client.user.id,panelMarker('ticket:'+id));
  if(m)await m.edit({...payload(b),flags:32768});else {m=await channel.send(payload(b));this.db.run('UPDATE tickets SET message_id=? WHERE id=?',m.id,id);}
 }
 async act(g:Guild,m:GuildMember,id:number,action:string,reason='') {
  return this.serial.run('ticket:'+id,async()=>{
   const t=this.access(m,id,!['close'].includes(action));const channel=await this.channel(g,id);
   if(action==='archive'){await this.logs.archive(g,channel,id);return;}
   if(action==='claim'){this.orders.claim(id,m.id);await this.refresh(g,id);return;}
   const data=JSON.parse(t.data);
   if(action==='close') {
    if(t.state!=='open')throw new UserError('Тикет уже закрыт.');if(!reason.trim())throw new UserError('Укажите причину закрытия.');
    await this.logs.archive(g,channel,id);
    await channel.edit({parent:requireValue(this.db.id('categories.archive'),'Архивная категория не настроена.'),permissionOverwrites:overwrites(this.db,g.id,g.client.user.id,'tickets',t.user_id,true,data.extra??[])});
    this.db.run('UPDATE tickets SET state=\'closed\' WHERE id=?',id);
   } else if(action==='reopen') {
    if(t.state!=='closed')throw new UserError('Тикет уже открыт.');
    this.db.tx(()=>{if(this.orders.active(t.user_id,t.kind,JSON.parse(t.data).type??'').length>=this.config().tickets.activePerType)throw new UserError('Достигнут лимит активных тикетов этого пользователя.');this.db.run('UPDATE tickets SET state=\'creating\' WHERE id=?',id);});
    try{await channel.edit({parent:requireValue(this.db.id('categories.tickets'),'Категория тикетов не настроена.'),permissionOverwrites:overwrites(this.db,g.id,g.client.user.id,'tickets',t.user_id,false,data.extra??[])});}catch(e){this.db.run('UPDATE tickets SET state=\'closed\' WHERE id=?',id);throw e;}
    this.db.run('UPDATE tickets SET state=\'open\' WHERE id=?',id);
   } else if(action==='delete') {
    if(t.state!=='closed')throw new UserError('Сначала закройте тикет.');if(!reason.trim())throw new UserError('Укажите причину удаления.');
    await this.logs.archive(g,channel,id);await channel.delete('Удаление закрытого тикета: '+id);this.db.run('UPDATE tickets SET state=\'deleted\' WHERE id=?',id);
   } else throw new UserError('Неизвестное действие.');
   this.db.audit('ticket:'+id,m.id,action,{reason});const names:Record<string,string>={close:'Тикет закрыт',reopen:'Тикет открыт повторно',delete:'Тикет удалён'};this.logs.queue('ticketLog',{title:names[action]??'Действие с тикетом',description:action==='delete'?`Тикет **#${String(id).padStart(6,'0')}**`:`<#${channel.id}>`,color:action==='reopen'?0x57f287:0xed4245,fields:[{name:'Исполнитель',value:`<@${m.id}>`},...(reason?[{name:'Причина',value:safeText(reason)}]:[])]});
   if(action!=='delete')await this.refresh(g,id);
  });
 }
 async participant(g:Guild,m:GuildMember,id:number,user:string,remove:boolean) {
  return this.serial.run('ticket:'+id,async()=>{
   const t=this.access(m,id,true);if(user===t.user_id||user===g.client.user.id)throw new UserError('Нельзя убрать автора или бота.');
   const target=await g.members.fetch(user);if(can(this.db,target.id,target.roles.cache.keys(),'staff'))throw new UserError('Доступ сотрудника определяется служебной ролью.');
   const data=JSON.parse(t.data),extra=new Set<string>(data.extra??[]);remove?extra.delete(user):extra.add(user);data.extra=[...extra];
   const channel=await this.channel(g,id);await channel.permissionOverwrites.set(overwrites(this.db,g.id,g.client.user.id,'tickets',t.user_id,t.state==='closed',data.extra));
   this.db.run('UPDATE tickets SET data=? WHERE id=?',JSON.stringify(data),id);this.db.audit('ticket:'+id,m.id,remove?'participantRemoved':'participantAdded',{user});this.logs.queue('ticketLog',{title:remove?'Участник удалён из тикета':'Участник добавлен в тикет',description:`<#${channel.id}>`,fields:[{name:'Участник',value:`<@${user}>`},{name:'Исполнитель',value:`<@${m.id}>`}]});
  });
 }
}
