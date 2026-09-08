import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/db.js';
import { Outbox } from '../src/modules/outbox.js';
test('Журналы ожидают настройки канала, не спамят и не блокируют другие задания',async()=>{
 const db=new Store(':memory:');for(let i=0;i<40;i++)db.enqueue('log',{key:'roleLog',message:'Роль создана'});db.enqueue('orderStatus',{ticket:1});
 const warnings:string[]=[],delivered:string[]=[],outbox=new Outbox(db,Date.now,m=>warnings.push(m));
 await outbox.drain(async(job)=>{delivered.push(job.kind);});assert.deepEqual(delivered,['orderStatus']);assert.equal(warnings.length,0);assert.equal(db.get('SELECT COUNT(*) n FROM outbox')!.n,40);
 db.bind('channels.roleLog','channel');await outbox.drain(async(job)=>{delivered.push(job.kind);});assert.equal(db.get('SELECT COUNT(*) n FROM outbox')!.n,10);db.close();
});
test('Отказ доступа к одному журналу даёт одну попытку за пять минут, записи сохраняются',async()=>{
 const db=new Store(':memory:');db.bind('channels.roleLog','channel');for(let i=0;i<5;i++)db.enqueue('log',{key:'roleLog',message:'Роль создана'});
 let now=0,attempts=0;const warnings:string[]=[],outbox=new Outbox(db,()=>now,m=>warnings.push(m));
 const fail=async()=>{attempts++;throw Object.assign(new Error('Missing Permissions'),{code:50013});};
 await outbox.drain(fail);await outbox.drain(fail);assert.equal(attempts,1);assert.equal(warnings.length,1);assert.equal(db.get('SELECT COUNT(*) n FROM outbox')!.n,5);
 now=300000;await outbox.drain(async()=>{});assert.equal(db.get('SELECT COUNT(*) n FROM outbox')!.n,0);db.close();
});
