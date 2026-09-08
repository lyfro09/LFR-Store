import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,remote } from './helpers.js';
import { buildPanel,Panels,panelMarker } from '../src/modules/panels.js';
import { validateComponents } from '../src/core/ui.js';
function texts(data:any) {return JSON.stringify(data.components.map((x:any)=>x.toJSON()));}
test('Все публичные панели соответствуют лимитам Components V2; баннеры подключены целиком',()=>{
 const {db,c}=fixture(),panels=new Panels(db,()=>c);
 for(const key of panels.keys()){const p=buildPanel(key,c,db);validateComponents(p.components!.map((x:any)=>x.toJSON()));assert.equal(p.flags,32768);assert.equal(p.content,undefined);assert.equal(p.embeds,undefined);assert.deepEqual(p.allowedMentions?.parse,[]);}
 for(const key of ['information','rules','tickets','products']){const p=buildPanel(key,c,db),json=(p.components![0] as any).toJSON();assert.equal(json.components[0].type,12);assert.equal(json.components[0].items[0].media.url,`attachment://${key}.png`);assert.equal(json.components[0].items[0].description,undefined);assert.equal(p.files.length,1);}
 const p=buildPanel('products',c,db);assert.match(texts(p),/category:view/);assert.match(texts(p),/Выберите категорию/);db.close();
});
test('Панель отзывов не содержит публикацию через бота',()=>{const {db,c}=fixture(),s=texts(buildPanel('reviews',c,db));assert.equal(s.includes('Оставить отзыв'),false);assert.equal(s.includes('custom_id\\\":\\\"review'),false);db.close();});
test('Информация скрывает пустые контакты и год, подставляет сохранённые ID и общие сроки',()=>{
 const {db,c}=fixture();let s=texts(buildPanel('information',c,db));
 assert.match(s,/LFR STORE/);assert.match(s,new RegExp(`<#${db.id('channels.products')}>`));assert.match(s,new RegExp(`<@&${db.id('roles.seller')}>`));
 for(const x of ['{SHOP_NAME}','{SELLER_ROLE}','Telegram —','Работаем с','По сотрудничеству','Discord —'])assert.equal(s.includes(x),false);
 c.DISCORD_URL='https://discord.gg/example';c.TELEGRAM_URL='https://t.me/example';c.PARTNERSHIP_CONTACT='<@123456789012345678>';c.START_YEAR='2020';c.delivery.subscriptions='до 24 часов после подтверждения оплаты';
 s=texts(buildPanel('information',c,db));for(const value of [c.DISCORD_URL,c.TELEGRAM_URL,c.PARTNERSHIP_CONTACT,'2020','до 24 часов'])assert.ok(s.includes(value));assert.match(texts(buildPanel('rules',c,db)),/до 24 часов/);db.close();
});
test('Обновление панели сохраняет message ID и заменяет вложение; повторный запуск восстанавливает ID',async()=>{
 const {db,c}=fixture(),{guild,channels}=remote(db),panels=new Panels(db,()=>c);
 const first=await panels.publish(guild,'information'),channel=channels.get(db.id('channels.information')!)!;
 c.appearance.banners.information='assets/rules.png';const second=await panels.publish(guild,'information');assert.equal(first,second);assert.equal(channel.sendCalls.length,1);
 const m=channel._messages.get(first);assert.deepEqual(m.edits[0].attachments,[]);assert.match(m.edits[0].files[0].attachment,/assets\/rules.png$/);
 db.run('UPDATE panels SET message_id=NULL WHERE key=\'information\'');assert.equal(await new Panels(db,()=>c).publish(guild,'information'),first);assert.equal(channel.sendCalls.length,1);db.close();
});
test('Одновременная публикация не дублирует сообщение; панель работает без баннера',async()=>{
 const {db,c}=fixture(),{guild,channels}=remote(db),panels=new Panels(db,()=>c);c.appearance.banners.information='';
 const ids=await Promise.all([panels.publish(guild,'information'),panels.publish(guild,'information')]);assert.equal(ids[0],ids[1]);assert.equal(channels.get(db.id('channels.information')!)!.sendCalls.length,1);assert.equal(buildPanel('information',c,db).files.length,0);db.close();
});
test('Недоступное сообщение панели не считается удалённым при 403',async()=>{
 const {db,c}=fixture(),{guild,channels}=remote(db),panels=new Panels(db,()=>c);await panels.publish(guild,'information');const channel=channels.get(db.id('channels.information')!)!;channel.messages.fetch=async()=>{throw Object.assign(new Error('Missing Access'),{code:50001});};await assert.rejects(panels.publish(guild,'information'));assert.equal(channel.sendCalls.length,1);db.close();
});
test('Слишком длинные настройки отклоняются до запроса Discord',()=>{const {db,c}=fixture();c.information.welcome='x'.repeat(3900);assert.throws(()=>buildPanel('information',c,db),/лимит Discord/);db.close();});

test('ID всех панелей, тикетов, отзывов и заявок помещаются в положительный int32',()=>{
 const {db,c}=fixture();const keys=[...new Panels(db,()=>c).keys(),...Array.from({length:1000},(_,i)=>['ticket:'+i,'review:'+i,'giveaway:'+i]).flat()];
 for(const key of keys){const id=panelMarker(key);assert.ok(Number.isInteger(id)&&id>0&&id<=2147483647,key);assert.equal(panelMarker(key),id);}
 db.close();
});
test('Локальная валидация отклоняет int32 overflow до отправки в Discord',()=>{
 assert.throws(()=>validateComponents([{type:17,id:2147483648,components:[]}]),/2147483647/);
 assert.throws(()=>validateComponents([{type:17,components:[{type:10,id:4294967295,content:'Текст'}]}]),/2147483647/);
 assert.doesNotThrow(()=>validateComponents([{type:17,id:2147483647,components:[]}]));
});

test('Удалённый канал панели восстанавливается в новом канале без устаревшего message ID',async()=>{
 const {db,c}=fixture(),{guild,channels,add}=remote(db),panels=new Panels(db,()=>c);
 const original=await panels.publish(guild,'information'),oldChannel=db.id('channels.information')!;
 channels.delete(oldChannel);const replacement=add('replacement-channel');db.bind('channels.information',replacement.id);
 const id=await panels.publish(guild,'information');assert.notEqual(id,original);assert.equal(db.get("SELECT channel_id FROM panels WHERE key='information'")!.channel_id,replacement.id);
 assert.equal(await panels.publish(guild,'information'),id);assert.equal(replacement.sendCalls.length,1);db.close();
});
test('Ошибка доступа к прежнему каналу не разрешает перенос панели',async()=>{
 const {db,c}=fixture(),{guild,add}=remote(db),panels=new Panels(db,()=>c);
 await panels.publish(guild,'information');const old=db.id('channels.information')!,replacement=add('replacement-channel');db.bind('channels.information',replacement.id);
 const fetch=guild.channels.fetch;guild.channels.fetch=async(id:string)=>{if(id===old)throw Object.assign(new Error('Missing Access'),{code:50001});return fetch(id);};
 await assert.rejects(panels.publish(guild,'information'));assert.equal(replacement.sendCalls.length,0);assert.equal(db.get("SELECT channel_id FROM panels WHERE key='information'")!.channel_id,old);db.close();
});
test('Существующая панель в прежнем канале не дублируется при смене привязки',async()=>{
 const {db,c}=fixture(),{guild,add}=remote(db),panels=new Panels(db,()=>c);await panels.publish(guild,'information');
 const replacement=add('replacement-channel');db.bind('channels.information',replacement.id);
 await assert.rejects(panels.publish(guild,'information'),/ещё существует/);assert.equal(replacement.sendCalls.length,0);db.close();
});
