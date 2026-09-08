import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture,remote } from './helpers.js';
import { Store } from '../src/core/db.js';
import { Catalog } from '../src/modules/catalog.js';
import { Orders } from '../src/modules/orders.js';
import { Tickets } from '../src/modules/tickets.js';
import { Giveaways,parseGiveawayUrl } from '../src/modules/giveaways.js';
import { Logs } from '../src/modules/logs.js';
import { Reviews } from '../src/modules/reviews.js';
import { Statistics } from '../src/modules/statistics.js';
import { can,overwrites,rolePermissions,setupAllowed } from '../src/core/auth.js';
import { PermissionFlagsBits as P,Collection } from 'discord.js';
function sellable(catalog:Catalog) {catalog.saveProduct({...catalog.product('nitro'),price:10001,available:true,terms:'Подарочная ссылка на один месяц.'});}
test('Golden 3%, максимум скидок, единое округление и блокировка ненастроенных товаров',()=>{
 const {db,c,catalog}=fixture();assert.throws(()=>catalog.quote('nitro',undefined,[],c));sellable(catalog);
 const g=db.id('roles.golden')!,d=db.id('roles.diamond')!;db.set('discounts',{[g]:3,[d]:7});
 const q=catalog.quote('nitro',undefined,[g],c);assert.equal(q.deliveryKind,'subscriptions');assert.equal(q.discount,3);assert.equal(q.discountAmount,300);assert.equal(q.total,9701);
 assert.equal(catalog.quote('nitro',undefined,[g,d],c).discount,7);assert.equal(catalog.quote('nitro',undefined,[],c).discount,0);assert.throws(()=>catalog.saveProduct({...catalog.product('nitro'),currency:'JPY'}));db.close();
});
test('Повторное подтверждение и активный лимит создают один заказ/тикет; снимок не меняется',()=>{
 const {db,c,catalog}=fixture();sellable(catalog);const o=new Orders(db),s=o.session('buyer',30),q=catalog.quote('nitro',undefined,[],c);
 const a=o.reserve('buyer','purchase',c,{},s,q),b=o.reserve('buyer','purchase',c,{},s,q),d=o.reserve('buyer','purchase',c,{},'other',q);
 assert.equal(a.id,b.id);assert.equal(a.id,d.id);assert.equal(db.get('SELECT COUNT(*) n FROM orders')!.n,1);
 catalog.saveProduct({...catalog.product('nitro'),price:50000});assert.equal(JSON.parse(db.get('SELECT data FROM orders')!.data).price,10001);db.close();
});
test('Два сотрудника не забирают один тикет; статусы и сумма покупок идемпотентны',()=>{
 const {db,c,catalog}=fixture();sellable(catalog);const o=new Orders(db),q=catalog.quote('nitro',undefined,[],c),r=o.reserve('buyer','purchase',c,{},'session',q);db.run('UPDATE tickets SET state=\'open\' WHERE id=?',r.id);
 o.claim(r.id,'seller1');assert.throws(()=>o.claim(r.id,'seller2'));
 assert.throws(()=>o.transition(r.id,'seller','completed'));o.transition(r.id,'seller','paid');assert.throws(()=>o.transition(r.id,'seller','paid'));assert.throws(()=>o.transition(r.id,'seller','cancelled','причина'));
 o.transition(r.id,'seller','working');o.transition(r.id,'seller','completed');assert.throws(()=>o.transition(r.id,'seller','completed'));assert.equal(db.get('SELECT COUNT(*) n FROM spend')!.n,1);db.close();
});
test('Сессии привязаны к автору, сроку и отмене; состояние сохраняется после перезапуска',()=>{
 const dir=mkdtempSync(join(tmpdir(),'shop-')),path=join(dir,'test.sqlite');const {db,c,catalog}=fixture(path);sellable(catalog);const o=new Orders(db),s=o.session('buyer',30,{product:'nitro'});
 assert.throws(()=>o.readSession(s,'intruder'));o.saveSession(s,{cancelled:true});assert.throws(()=>o.readSession(s,'buyer'));
 const s2=o.session('buyer',30);db.run('UPDATE sessions SET expires=0 WHERE id=?',s2);assert.throws(()=>o.readSession(s2,'buyer'));
 o.reserve('buyer','purchase',c,{},'persisted',catalog.quote('nitro',undefined,[],c));db.close();const restarted=new Store(path);assert.equal(restarted.get('SELECT session_id FROM orders')!.session_id,'persisted');assert.equal(new Catalog(restarted).product('nitro').price,10001);restarted.close();rmSync(dir,{recursive:true});
});
test('Настройка разрешена только точному ID в DM, роли не заменяют ID',()=>{
 assert.equal(setupAllowed('689455809612349463',false,false,null),true);
 for(const args of [['689455809612349463',true,false,null],['other',false,false,null],['689455809612349463',false,true,null],['689455809612349463',false,false,'webhook']] as const)assert.equal(setupAllowed(args[0],args[1],args[2],args[3]),false);
});
test('Права по ID: Manager/Developer/покупатель не проводят оплату; закрытые области не открыты участнику',()=>{
 const {db}=fixture();for(const r of ['manager','developer','sponsor','partner','diamond','golden','bronze','member'])assert.equal(can(db,'someone',[db.id('roles.'+r)!],'sales'),false);
 assert.equal(can(db,'someone',[db.id('roles.seller')!],'sales'),true);assert.equal(can(db,'someone',['Seller'],'sales'),false);
 for(const access of ['tickets','admin','staff','technical','moderation']){
  const ow=overwrites(db,'guild','bot',access,'buyer') as any[];assert.ok(ow[0].deny.includes(P.ViewChannel));assert.equal(ow.some(x=>x.id===db.id('roles.member')),false);
  for(const r of ['sponsor','partner','diamond','golden','bronze'])assert.equal(ow.some(x=>x.id===db.id('roles.'+r)),false);
  if(access==='tickets')assert.equal(ow.some(x=>x.id===db.id('roles.developer')),false);
 }
 const reviewAccess=overwrites(db,'guild','bot','reviews') as any[];for(const rank of ['bronze','golden','diamond']){const rule=reviewAccess.find(x=>x.id===db.id('roles.'+rank));assert.ok(rule);assert.ok(rule.allow.includes(P.SendMessages));}
 assert.equal(rolePermissions('manager'),P.ModerateMembers);assert.equal(rolePermissions('seller'),0n);assert.equal(rolePermissions('admin'),P.Administrator);db.close();
});
test('Посторонний не получает доступ к тикету, архивная ошибка запрещает закрытие и удаление',async()=>{
 const {db,c}=fixture(),orders=new Orders(db),{guild,add}=remote(db),r=orders.reserve('buyer','support',c,{subject:'Тема',description:'Вопрос'}),channel=add('ticket-channel');
 db.run('UPDATE tickets SET channel_id=?,state=\'open\' WHERE id=?',channel.id,r.id);
 const logs:any={archive:async()=>{throw new Error('archive failed');},queue:()=>{}};const tickets=new Tickets(db,()=>c,orders,logs);
 const member=(id:string,roles:string[]=[])=>({id,roles:{cache:new Collection(roles.map(r=>[r,{}]))}} as any);
 assert.throws(()=>tickets.access(member('intruder'),r.id));
 await assert.rejects(tickets.act(guild,member('buyer'),r.id,'close','причина'),/archive failed/);assert.equal(tickets.get(r.id).state,'open');assert.equal(channel.editCalls.length,0);
 db.run('UPDATE tickets SET state=\'closed\' WHERE id=?',r.id);await assert.rejects(tickets.act(guild,member('seller',[db.id('roles.seller')!]),r.id,'delete','причина'),/archive failed/);assert.equal(channel.deleted,false);db.close();
});
test('Ссылки розыгрыша строго Discord; повторная ссылка возвращает одну заявку и одно сообщение',async()=>{
 assert.throws(()=>parseGiveawayUrl('https://example.com/secret'));assert.throws(()=>parseGiveawayUrl('https://discord.com.evil.test/channels/1/2/3'));
 const {db}=fixture(),{guild,channels}=remote(db),logs=new Logs(db),giveaways=new Giveaways(db,logs);guild.client.channels={fetch:async()=>{throw new Error('Missing Access');}};
 const url='https://discord.com/channels/123456789012345678/223456789012345678/323456789012345678';
 const [a,b]=await Promise.all([giveaways.submit(guild,'buyer',url),giveaways.submit(guild,'buyer',url)]);assert.equal(a.id,b.id);assert.equal(JSON.parse(a.data).verified,false);assert.equal(db.get('SELECT COUNT(*) n FROM giveaways')!.n,1);assert.equal(channels.get(db.id('channels.giveawayLog')!)!.sendCalls.length,1);db.close();
});
test('Отзыв только за свой выполненный заказ; повторное редактирование и удаление не удваивают счётчик',async()=>{
 const {db,c,catalog}=fixture();sellable(catalog);const orders=new Orders(db),{guild}=remote(db),reviews=new Reviews(db),q=catalog.quote('nitro',undefined,[],c),r=orders.reserve('buyer','purchase',c,{},'review-session',q),id=Number(db.get('SELECT id FROM orders')!.id);
 await assert.rejects(reviews.submit(guild,'buyer',id,5,'Спасибо'));db.run('UPDATE tickets SET state=\'open\' WHERE id=?',r.id);for(const status of ['paid','working','completed'])orders.transition(r.id,'seller',status);
 await assert.rejects(reviews.submit(guild,'stranger',id,5,'Спасибо'));await assert.rejects(reviews.submit(guild,'buyer',id,0,'Спасибо'));
 const a=await reviews.submit(guild,'buyer',id,1,'Есть замечания'),b=await reviews.submit(guild,'buyer',id,2,'Дополнение');assert.equal(a,b);assert.equal(db.get('SELECT COUNT(*) n FROM reviews WHERE published=1')!.n,1);
 const m=db.get('SELECT message_id FROM reviews')!.message_id;reviews.removed(m);reviews.removed(m);assert.equal(db.get('SELECT COUNT(*) n FROM reviews WHERE published=1')!.n,0);db.close();
});
test('Статистика получает полный состав, не использует неполный кэш и не переименовывает неизменившееся',async()=>{
 const {db,c}=fixture(),{guild,channels}=remote(db);let fetches=0;guild.members={cache:new Collection([['one',{}]]),fetch:async()=>{fetches++;return new Collection([['one',{user:{bot:false}}],['two',{user:{bot:false}}],['bot',{user:{bot:true}}]]);}};
 const reviews=new Reviews(db),logs=new Logs(db),stats=new Statistics(db,()=>c,reviews,logs);await stats.update(guild);assert.equal(db.value<any>('statistics',{}).members,2);assert.equal(fetches,1);
 const channel=channels.get(db.id('channels.statsMembers')!)!;assert.equal(channel.renamed,1);db.set('statistics',{...db.value<any>('statistics',{}),checkedAt:0,nextAttemptAt:0});await stats.update(guild);assert.equal(channel.renamed,1);assert.equal(fetches,2);db.close();
});
