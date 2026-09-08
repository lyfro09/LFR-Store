import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { roleOrder } from '../src/core/auth.js';
import { planRolePositions,sortedRoles,verifyRoleOrder,type PositionedRole } from '../src/modules/role-order.js';
function data(){
 const {db}=fixture();const bot={id:'100000000000000001',name:'Bot',rawPosition:2,managed:true};
 const roles:PositionedRole[]=[{id:'100000000000000000',name:'@everyone',rawPosition:0,managed:false},bot];
 for(const [i,key] of [...roleOrder].reverse().entries()){const id=String(200000000000000000n+BigInt(i));db.bind('roles.'+key,id);roles.push({id,name:key,rawPosition:1,managed:false});}
 return {db,roles,bot};
}
test('Роль бота с rawPosition=2 выше десяти ролей с rawPosition=1: расстановка допустима',()=>{
 const {db,roles,bot}=data(),plan=planRolePositions(roles,bot.id,db);
 assert.equal(plan.length,12);assert.equal(plan.at(-1)!.role,bot.id);assert.equal(plan[0].position,0);
 assert.deepEqual(plan.slice(1,-1).map(x=>x.role),[...roleOrder].reverse().map(k=>db.id('roles.'+k)));
 const updated=roles.map(r=>({...r,rawPosition:plan.find(x=>x.role===r.id)!.position}));verifyRoleOrder(updated,bot.id,db);assert.deepEqual(planRolePositions(updated,bot.id,db),[]);db.close();
});
test('Чужие роли сохраняют места, а собственная роль бота не поднимается относительно них',()=>{
 const {db,roles,bot}=data();roles.push({id:'300000000000000000',name:'Other lower',rawPosition:1,managed:false},{id:'400000000000000000',name:'Other higher',rawPosition:5,managed:true});
 const before=sortedRoles(roles),plan=planRolePositions(roles,bot.id,db);
 for(const r of [bot,...roles.filter(x=>x.name.startsWith('Other'))])assert.equal(plan.findIndex(p=>p.role===r.id),before.findIndex(p=>p.id===r.id));db.close();
});
test('Роль магазина действительно выше бота: отказ до запроса API',()=>{
 const {db,roles,bot}=data();roles.find(r=>r.name==='admin')!.rawPosition=3;assert.throws(()=>planRolePositions(roles,bot.id,db),/должна находиться выше/);db.close();
});
test('При одинаковой rawPosition порядок определяется snowflake, не числом свободных позиций',()=>{
 const {db,roles,bot}=data();bot.rawPosition=1;assert.doesNotThrow(()=>planRolePositions(roles,bot.id,db));db.close();
});
