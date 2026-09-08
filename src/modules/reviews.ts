import { type Guild, type GuildMember, type Message, type TextChannel } from 'discord.js';
import { Store, Serial, UserError, requireValue } from '../core/db.js';
import { authorize } from '../core/auth.js';
import { box,payload,safeText,colors } from '../core/ui.js';
import { findMarkedMessage,panelMarker } from './panels.js';
import { overwrites } from '../core/auth.js';
export class Reviews {
 readonly serial=new Serial();
 constructor(readonly db:Store) {}
 eligible(user:string) { return this.db.all('SELECT * FROM orders WHERE user_id=? AND status=\'completed\' ORDER BY id DESC',user); }
 async channel(g:Guild){const id=requireValue(this.db.id('channels.reviews'),'Канал отзывов не настроен.');const c=await g.channels.fetch(id);if(!c?.isTextBased()||c.isThread())throw new UserError('Канал отзывов недоступен.');return c as TextChannel;}
 async configure(g:Guild) {const c=await this.channel(g);await c.permissionOverwrites.set(overwrites(this.db,g.id,g.client.user.id,'reviews'));}
 async capture(message:Message) {
  if(message.guildId!==process.env.GUILD_ID||message.channelId!==this.db.id('channels.reviews')||message.author.bot||message.webhookId)return;
  const member=message.member??await message.guild!.members.fetch(message.author.id),ranks=['bronze','golden','diamond'].map(k=>this.db.id('roles.'+k)).filter(Boolean) as string[];
  if(!ranks.some(id=>member.roles.cache.has(id))){await message.delete().catch(()=>{});return;}
  if(!message.content.trim()&&!message.attachments.size){await message.delete().catch(()=>{});return;}
  this.db.run('INSERT OR IGNORE INTO direct_reviews(message_id,user_id,created) VALUES (?,?,?)',message.id,message.author.id,message.createdTimestamp);await message.react('⭐').catch(()=>{});
 }
 count() {return Number(this.db.get('SELECT (SELECT COUNT(*) FROM reviews WHERE published=1)+(SELECT COUNT(*) FROM direct_reviews) n')!.n);}
 async submit(g:Guild,user:string,order:number,rating:number,body:string) {
  if(!Number.isInteger(rating)||rating<1||rating>5||!body.trim()||body.length>1500)throw new UserError('Оценка — целое число от 1 до 5; отзыв — от 1 до 1500 символов.');
  return this.serial.run('review:'+order,async()=>{
   const o=requireValue(this.db.get('SELECT * FROM orders WHERE id=? AND user_id=? AND status=\'completed\'',order,user),'Нужен ваш выполненный заказ.');
   const old=this.db.get('SELECT * FROM reviews WHERE order_id=?',order);
   if(old&&JSON.parse(old.data).imported)throw new UserError('Импортированный отзыв можно отредактировать в исходном сообщении.');
   if(old&&JSON.parse(old.data).removed)throw new UserError('Отзыв снят с публикации модератором. Обратитесь в поддержку.');
   const data=JSON.stringify({rating,body,product:JSON.parse(o.data).name});
   this.db.run('INSERT INTO reviews(order_id,user_id,data) VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET data=excluded.data',order,user,data);
   return this.publish(g,order);
  });
 }
 async publish(g:Guild,order:number) {
  const r=requireValue(this.db.get('SELECT * FROM reviews WHERE order_id=?',order),'Отзыв не найден.'),data=JSON.parse(r.data),channel=await this.channel(g);
  const b=box([`## ${'⭐'.repeat(data.rating)} Отзыв о покупке\n-# Подтверждённый заказ #${order}`,`**Покупатель:** <@${r.user_id}>\n**Товар:** ${safeText(data.product)}`,`> ${safeText(data.body).replace(/\n/g,'\n> ')}`],colors.warning).setId(panelMarker('review:'+order));
  let m;if(r.message_id)try{m=await channel.messages.fetch(r.message_id);}catch(e){if((e as {code?:number}).code!==10008)throw e;}
  if(!m)m=await findMarkedMessage(channel,g.client.user.id,panelMarker('review:'+order));
  if(m)await m.edit({...payload(b),flags:32768});else m=await channel.send(payload(b));
  this.db.run('UPDATE reviews SET message_id=?,published=1 WHERE order_id=?',m.id,order);return m.url;
 }
 removed(message:string) {this.db.tx(()=>{this.db.run('UPDATE reviews SET published=0 WHERE message_id=? AND published=1',message);this.db.run('DELETE FROM direct_reviews WHERE message_id=?',message);});}
 async moderate(g:Guild,m:GuildMember,id:number,reason:string) {
  authorize(this.db,m,'moderation');if(!reason.trim())throw new UserError('Укажите причину.');
  return this.serial.run('review:'+id,async()=>{const r=requireValue(this.db.get('SELECT * FROM reviews WHERE order_id=?',id),'Отзыв не найден.');
   const channel=await this.channel(g);if(r.message_id)try{await channel.messages.delete(r.message_id);}catch(e){if((e as {code?:number}).code!==10008)throw e;}
   this.db.run('UPDATE reviews SET published=0,data=? WHERE order_id=?',JSON.stringify({...JSON.parse(r.data),removed:true,reason}),id);this.db.audit('review:'+id,m.id,'removed',{reason});this.db.enqueue('log',{key:'messageLog',event:{title:'Отзыв снят с публикации',color:0xed4245,fields:[{name:'Заказ',value:`#${id}`},{name:'Модератор',value:`<@${m.id}>`},{name:'Причина',value:safeText(reason)}]}});
  });
 }
 async reconcile(g:Guild) {const channel=await this.channel(g);for(const r of [...this.db.all('SELECT message_id FROM reviews WHERE published=1'),...this.db.all('SELECT message_id FROM direct_reviews')])try{await channel.messages.fetch(r.message_id);}catch(e){if((e as {code?:number}).code===10008)this.removed(r.message_id);else throw e;}}
 async import(g:Guild,m:GuildMember,order:number,messageId:string) {
  authorize(this.db,m,'admin');const o=requireValue(this.db.get('SELECT * FROM orders WHERE id=? AND status=\'completed\'',order),'Укажите выполненный заказ.');
  const msg=await (await this.channel(g)).messages.fetch(messageId);if(msg.author.id!==o.user_id)throw new UserError('Автор сообщения должен совпадать с покупателем заказа.');
  if(this.db.get('SELECT id FROM reviews WHERE order_id=? OR message_id=?',order,messageId))throw new UserError('Отзыв уже учтён.');
  this.db.run('INSERT INTO reviews(order_id,user_id,message_id,published,data) VALUES (?,?,?,1,?)',order,o.user_id,messageId,JSON.stringify({imported:true,product:JSON.parse(o.data).name}));this.db.audit('review:'+order,m.id,'imported',{messageId});
 }
}
