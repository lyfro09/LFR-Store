import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { fixture,remote } from './helpers.js';
import { Statistics } from '../src/modules/statistics.js';
function setup(){
 const {db,c}=fixture(),{guild,channels}=remote(db);let calls=0,now=10_000_000;
 const errors:unknown[]=[],messages:unknown[]=[];
 guild.members={fetch:async()=>{calls++;return new Collection([['human',{user:{bot:false}}],['bot',{user:{bot:true}}]]);}};
 guild.client.users={fetch:async()=>({send:async(p:unknown)=>{messages.push(p);}})};
 const reviews:any={reconcile:async()=>{},count:()=>0};
 const logs:any={error:(e:unknown)=>{errors.push(e);}};
 const stats=new Statistics(db,()=>c,reviews,logs,()=>now);
 return {db,c,guild,channels,errors,messages,reviews,stats,calls:()=>calls,advance:(ms:number)=>{now+=ms;}};
}
test('Статистика ждёт завершения создания необходимых каналов без запросов и предупреждений',async()=>{
 const f=setup(),id=f.db.id('channels.reviews')!;f.db.run("DELETE FROM resources WHERE key='channels.reviews'");
 await f.stats.update(f.guild,true);assert.equal(f.calls(),0);assert.equal(f.messages.length,0);assert.equal(f.errors.length,0);assert.equal(f.db.value('statistics',null),null);
 f.db.bind('channels.reviews',id);await f.stats.update(f.guild);assert.equal(f.calls(),1);assert.equal(f.db.value<any>('statistics',{}).members,1);f.db.close();
});
test('Ошибка отзывов сохраняет проверенные значения, указывает шаг и не повторяется каждые 30 секунд',async()=>{
 const f=setup();f.db.set('statistics',{members:20,reviews:7,checkedAt:1});f.reviews.reconcile=async()=>{throw Object.assign(new Error('Missing Access'),{code:50001});};
 await f.stats.update(f.guild);let state=f.db.value<any>('statistics',{});
 assert.equal(state.members,20);assert.equal(state.reviews,7);assert.equal(state.checkedAt,1);assert.equal(state.lastErrorCode,50001);assert.match(state.lastError,/проверка опубликованных отзывов/);assert.equal(f.messages.length,1);
 f.advance(30000);await f.stats.update(f.guild);assert.equal(f.calls(),1);assert.equal(f.errors.length,1);
 f.reviews.reconcile=async()=>{};f.advance(600000);await f.stats.update(f.guild);state=f.db.value<any>('statistics',{});assert.equal(state.members,1);assert.equal(state.reviews,0);assert.equal(state.lastError,null);assert.equal(f.messages.length,1);f.db.close();
});
test('Ошибка переименования не маскируется под отсутствие Guild Members Intent',async()=>{
 const f=setup(),channel=f.channels.get(f.db.id('channels.statsMembers')!)!;channel.setName=async()=>{throw Object.assign(new Error('Missing Permissions'),{code:50013});};
 await f.stats.update(f.guild);const state=f.db.value<any>('statistics',{});assert.match(state.lastError,/обновление канала участников/);assert.equal(state.lastErrorCode,50013);assert.equal(state.members,undefined);f.db.close();
});
