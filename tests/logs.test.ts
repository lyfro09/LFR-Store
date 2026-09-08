import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,remote } from './helpers.js';
import { Logs } from '../src/modules/logs.js';

test('Журнал оформляет событие заголовком, полями, временем и не создаёт уведомления',async()=>{
 const {db}=fixture(),{guild,channels}=remote(db),logs=new Logs(db),id=db.id('channels.roleLog')!;
 await logs.send(guild,'roleLog',{title:'Роли участника изменены',description:'<@123456789012345678>',fields:[{name:'Добавлены',value:'<@&223456789012345678>'}],timestamp:1_788_820_000_000});
 const sent=channels.get(id).sendCalls[0],json=JSON.stringify(sent);
 assert.match(json,/Роли участника изменены/);assert.match(json,/Добавлены/);assert.match(json,/<t:1788820000:F>/);assert.deepEqual(sent.allowedMentions.parse,[]);db.close();
});

test('Старые строковые задания очереди получают новое оформление',async()=>{
 const {db}=fixture(),{guild,channels}=remote(db),logs=new Logs(db),id=db.id('channels.techLog')!;
 await logs.send(guild,'techLog','Старая запись');const json=JSON.stringify(channels.get(id).sendCalls[0]);assert.match(json,/Техническое событие/);assert.match(json,/Старая запись/);db.close();
});
