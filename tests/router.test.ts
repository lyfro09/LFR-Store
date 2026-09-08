import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { fixture,remote } from './helpers.js';
import { Router } from '../src/router.js';
import { Orders } from '../src/modules/orders.js';
import { Tickets } from '../src/modules/tickets.js';
import { Panels } from '../src/modules/panels.js';
import { Reviews } from '../src/modules/reviews.js';
import { Giveaways } from '../src/modules/giveaways.js';
import { Ranks } from '../src/modules/roles.js';
import { Logs } from '../src/modules/logs.js';
import { form } from '../src/core/ui.js';
import { updateDiscordCatalog } from '../src/modules/catalog-updates.js';
function routeFixture(role='member') {
 const {db,c,catalog}=fixture(),{guild}=remote(db),orders=new Orders(db),logs=new Logs(db),tickets=new Tickets(db,()=>c,orders,logs);
 const member:any={id:'buyer',roles:{cache:new Collection([[db.id('roles.'+role)!,{}]])}};guild.members={fetch:async()=>member};
 const router=new Router(db,()=>c,()=>{},catalog,orders,tickets,new Panels(db,()=>c),new Giveaways(db,logs),new Reviews(db),new Ranks(db,()=>c),logs);
 const sent:any[]=[];const i:any={guild,guildId:guild.id,user:{id:member.id},deferred:false,replied:false,customId:'',message:{flags:{has:()=>false}},isChatInputCommand:()=>false,isModalSubmit:()=>false,isButton:()=>true,isStringSelectMenu:()=>false,deferReply:async()=>{i.deferred=true;i.ack='reply';},deferUpdate:async()=>{i.deferred=true;i.ack='update';},editReply:async(x:any)=>{sent.push(x);}};
 process.env.GUILD_ID=guild.id;return {db,c,catalog,guild,router,orders,tickets,i,sent,member};
}
test('Маршрутизатор отклоняет финансовую кнопку покупателя, Manager и Developer',async()=>{
 for(const role of ['member','manager','developer']) {
  const {db,c,orders,router,i,sent}=routeFixture(role);const r=orders.reserve('buyer','support',c,{});i.customId='order:paid:'+r.id;await router.handle(i);
  assert.match(JSON.stringify(sent),/нет прав/);assert.equal(db.get('SELECT COUNT(*) n FROM orders')!.n,0);db.close();
 }
});
test('Изменение цены требует повторного подтверждения и последующий двойной клик создаёт один заказ',async()=>{
 const {db,c,catalog,orders,tickets,router,i,sent}=routeFixture('golden');catalog.saveProduct({...catalog.product('nitro'),price:10000,available:true,terms:'Тестовые условия'});
 const quote=catalog.quote('nitro',undefined,[db.id('roles.golden')!],c);const sid=orders.session(i.user.id,30,{product:'nitro',quote});
 catalog.saveProduct({...catalog.product('nitro'),price:12000});
 await router.confirm(i,sid);assert.equal(db.get('SELECT COUNT(*) n FROM orders')!.n,0);assert.match(JSON.stringify(sent),/Проверьте новый итог/);
 tickets.ensure=async()=>({id:'confirmed-channel'} as any);
 await Promise.all([router.confirm(i,sid),router.confirm(i,sid)]);assert.equal(db.get('SELECT COUNT(*) n FROM orders')!.n,1);assert.equal(JSON.parse(db.get('SELECT data FROM orders')!.data).total,11640);db.close();
});
test('Другой сервер не меняется при нажатии кнопки',async()=>{const {db,i,router,sent}=routeFixture();i.guildId='other-server';i.customId='checkout';await router.handle(i);assert.match(JSON.stringify(sent),/только на настроенном сервере/);assert.equal(db.get('SELECT COUNT(*) n FROM sessions')!.n,0);db.close();});
test('Приватное меню обновляет одно сообщение, а публичная панель создаёт личный ответ',async()=>{
 const {db,i,router}=routeFixture();i.customId='browse';i.message.flags.has=()=>false;await router.handle(i);assert.equal(i.ack,'reply');
 i.deferred=false;i.ack='';i.customId='categories:view:0';i.message.flags.has=(flag:number)=>flag===64;await router.handle(i);assert.equal(i.ack,'update');db.close();
});
test('Кнопка розыгрыша принимает ссылку на выигрыш и создаёт отдельный тикет выдачи',async()=>{
 const {db,c,router,orders,tickets,i,sent}=routeFixture();let modal:any;i.showModal=async(m:any)=>{modal=m.toJSON();};i.customId='giveaway';await router.handle(i);
 assert.equal(modal.title,'🎁 Получение выигрыша');assert.match(modal.components[0].label,/сообщение о выигрыше/);
 tickets.ensure=async(_g:any,id:number)=>({id:'giveaway-ticket-'+id} as any);i.deferred=false;i.isButton=()=>false;i.isModalSubmit=()=>true;i.customId='giveaway-ticket-submit';i.fields={getTextInputValue:()=>`https://discord.com/channels/${i.guild.id}/123456789012345678/223456789012345678`};await router.handle(i);
 const ticket=db.get('SELECT * FROM tickets')!,data=JSON.parse(ticket.data);assert.equal(data.type,'giveaway-prize');assert.match(data.giveawayUrl,/discord\.com\/channels/);assert.match(JSON.stringify(sent.at(-1)),/Тикет для получения выигрыша создан/);
 orders.reserve(i.user.id,'support',c,{subject:'Обычная поддержка',description:'Вопрос'});assert.equal(db.get('SELECT COUNT(*) n FROM tickets')!.n,2);db.close();
});
test('Формы используют Label + TextInput и сериализуются в формат Discord',()=>{const m=form('test','Проверка',[{id:'text',label:'Текст',value:'Пример',long:true}]).toJSON();assert.equal(m.components[0].type,18);assert.equal((m.components[0] as any).component.type,4);});

function lastComponents(sent:any[]) {
 const all:any[]=[];
 const walk=(items:any[])=>{for(const item of items){all.push(item);if(item.components)walk(item.components);}};
 walk(JSON.parse(JSON.stringify(sent.at(-1))).components);return all;
}
async function choose(router:Router,i:any,id:string,value?:string) {
 i.customId=id;i.values=value?[value]:[];i.isStringSelectMenu=()=>value!==undefined;i.isButton=()=>value===undefined;
 await router.handle(i);
}
test('Nitro: Full/Basic → входом/гифтом; переход назад сбрасывает выбор, чужая группа отклоняется',async()=>{
 const {db,catalog,router,orders,i,sent}=routeFixture();updateDiscordCatalog(catalog);
 await choose(router,i,'product:view','nitro');
 let select=lastComponents(sent).find(c=>c.type===3);
 assert.deepEqual(select.options.map((o:any)=>o.label),['Full','Basic']);
 const sid=select.custom_id.split(':')[1];
 for(const group of ['full','basic']) {
  await choose(router,i,'variant-group:'+sid,group);
  select=lastComponents(sent).find(c=>c.type===3);
  assert.deepEqual(select.options.map((o:any)=>o.value),[group+'-login',group+'-gift']);
  assert.deepEqual(select.options.map((o:any)=>o.label),['Входом','Гифтом']);
  await choose(router,i,'variant:'+sid,(group==='full'?'basic':'full')+'-gift');
  assert.match(JSON.stringify(sent.at(-1)),/Сначала выберите тип/);
  for(const method of ['login','gift']) {
   await choose(router,i,'variant:'+sid,group+'-'+method);
   const buy=lastComponents(sent).find(c=>c.custom_id==='order-selected:'+sid);
   assert.equal(buy.disabled,true); // Browsing works before sale prices are configured.
   assert.equal(orders.readSession(sid,'buyer').variant,group+'-'+method);
  }
  await choose(router,i,'variant-groups:'+sid);
  assert.equal(orders.readSession(sid,'buyer').variant,undefined);
  assert.equal(orders.readSession(sid,'buyer').variantGroup,undefined);
 }
 i.user.id='other';await choose(router,i,'variant-group:'+sid,'full');
 assert.equal(orders.readSession(sid,'buyer').variantGroup,undefined);db.close();
});
test('Выбранный Nitro попадает в заказ с типом, способом и ценой; назад очищает итог',async()=>{
 const {db,catalog,router,orders,tickets,i,sent}=routeFixture('golden');updateDiscordCatalog(catalog);
 const p=catalog.product('nitro');catalog.saveProduct({...p,available:true,terms:'Условия тестовой покупки',variants:p.variants.map((v,index)=>({...v,available:true,price:10000+index*1000}))});
 await choose(router,i,'product:view','nitro');
 const sid=lastComponents(sent).find(c=>c.type===3).custom_id.split(':')[1];
 await choose(router,i,'variant-group:'+sid,'basic');await choose(router,i,'variant:'+sid,'basic-gift');
 await choose(router,i,'order-selected:'+sid);
 assert.equal(orders.readSession(sid,'buyer').quote?.variantName,'Basic · Гифтом');
 assert.equal(orders.readSession(sid,'buyer').quote?.total,12610);
 await choose(router,i,'variants:'+sid);assert.equal(orders.readSession(sid,'buyer').quote,undefined);
 await choose(router,i,'variant:'+sid,'basic-gift');
 tickets.ensure=async()=>({id:'order-channel'} as any);await router.confirm(i,sid);
 const snapshot=JSON.parse(db.get('SELECT data FROM orders')!.data);
 assert.equal(snapshot.variantId,'basic-gift');assert.equal(snapshot.variantName,'Basic · Гифтом');assert.equal(snapshot.total,12610);db.close();
});
test('Украшения открывают оставшиеся 9 номиналов в визуальном редакторе',async()=>{
 const {db,catalog,router,i,sent}=routeFixture('seller');updateDiscordCatalog(catalog);
 await choose(router,i,'product:order','decoration');
 const select=lastComponents(sent).find(c=>c.type===3);
 assert.deepEqual(select.options.map((o:any)=>o.label),['4.99','8.99','9.99','15.99','17.99','21.98','22.99','25.99','26.97'].map(n=>'Украшение за '+n+'$'));
 await choose(router,i,select.custom_id,'usd-26-97');assert.match(JSON.stringify(sent.at(-1)),/Украшение за 26.97/);
 i.isChatInputCommand=()=>true;i.commandName='product';i.options={getString:()=> 'decoration'};
 await router.handle(i);const editor=lastComponents(sent).find(c=>c.custom_id?.startsWith('pa-variant-open:'));
 assert.equal(editor.options.length,9);assert.equal(editor.options[0].label,'Украшение за 4.99$');assert.equal(editor.options[8].label,'Украшение за 26.97$');db.close();
});

test('Визуальный редактор Nitro меняет цену в рублях и защищает устаревшую сессию',async()=>{
 const {db,catalog,router,i,sent}=routeFixture('seller');updateDiscordCatalog(catalog);
 let modal:any;i.isChatInputCommand=()=>true;i.commandName='product';i.options={getString:()=> 'nitro'};i.showModal=async(m:any)=>{modal=m.toJSON();};
 await router.handle(i);let select=lastComponents(sent).find(c=>c.custom_id?.startsWith('pa-variant-open:'));
 assert.deepEqual(select.options.map((x:any)=>x.label),['Full · Входом','Full · Гифтом','Basic · Входом','Basic · Гифтом']);
 const sid=select.custom_id.split(':')[1];i.isChatInputCommand=()=>false;
 await choose(router,i,select.custom_id,'full-login');await choose(router,i,`pa-variant-form:${sid}:full-login`);
 assert.equal(modal.components[0].component.value,'Входом');
 i.isModalSubmit=()=>true;i.isButton=()=>false;i.customId=modal.custom_id;i.fields={getTextInputValue:(id:string)=>id==='name'?'Вход по приглашению':'350,50'};
 await router.handle(i);assert.equal(catalog.product('nitro').variants[0].price,35050);assert.equal(catalog.product('nitro').variants[0].name,'Вход по приглашению');
 i.isModalSubmit=()=>false;i.isButton=()=>true;catalog.saveProduct({...catalog.product('nitro'),description:'Внешнее изменение'});i.customId=`pa-available:${sid}`;await router.handle(i);
 assert.match(JSON.stringify(sent.at(-1)),/Товар изменился/);assert.equal(catalog.product('nitro').variants.length,4);db.close();
});
