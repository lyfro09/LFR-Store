import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection,PermissionFlagsBits as P } from 'discord.js';
import { fixture,remote } from './helpers.js';
import { Setup,describeSetupError } from '../src/modules/setup.js';
import { Panels } from '../src/modules/panels.js';
import { OWNER_ID } from '../src/core/config.js';
function server(db:any,c:any) {
 const net=remote(db),g=net.guild;let id=300000000000000000n,created=0;
 const roles=new Collection<string,any>();
 roles.set('900000000000000001',{id:'900000000000000001',name:'Bot',rawPosition:30,position:30,managed:true});
 const member:any={id:g.client.user.id,permissions:{has:()=>true},roles:{highest:{id:'900000000000000001',position:30,rawPosition:30}}};
 const assigned:string[]=[];const owner:any={id:OWNER_ID,user:{bot:false},roles:{cache:new Collection(),add:async(ids:any)=>{assigned.push(...(Array.isArray(ids)?ids:[ids]));}}};
 g.name='Тестовый сервер';g.members={fetchMe:async()=>member,fetch:async(user?:string)=>{if(user&&user!==OWNER_ID)throw new Error('Owner missing');return user?owner:new Collection([[OWNER_ID,owner]]);}};
 g.roles={cache:roles,fetch:async(r?:string)=>r?roles.get(r)??null:roles,create:async(options:any)=>{created++;const role:any={...options,id:String(id++),position:1,rawPosition:1,managed:false,edit:async(data:any)=>{Object.assign(role,data);return role;}};roles.set(role.id,role);return role;},setPositions:async(positions:any[])=>{for(const p of positions){const r=roles.get(p.role);if(r){r.position=p.position;r.rawPosition=p.position;}}}};
 g.channels.cache=new Collection();const oldFetch=g.channels.fetch;
 g.channels.fetch=async(cid?:string)=>cid?oldFetch(cid):new Collection(net.channels);
 g.channels.create=async(options:any)=>{created++;const channel=net.add(String(id++));Object.assign(channel,options,{guildId:g.id});return channel;};g.channels.setPositions=async()=>{};
 for(const channel of net.channels.values()){channel.guildId=g.id;channel.type=c.structure.channels.find((x:any)=>db.id('channels.'+x.key)===channel.id)?.type??0;}
 g.fetchAuditLogs=async()=>({entries:new Collection()});
 g.client.guilds={fetch:async(gid:string)=>{assert.equal(gid,g.id);return g;}};
 return {...net,member,assigned,created:()=>created};
}
test('DM-настройка не трогает другой сервер/автора и preview не создаёт ресурсы',async()=>{
 const {db,c}=fixture(),s=server(db,c),setup=new Setup(db,()=>c,new Panels(db,()=>c),async()=>{});process.env.GUILD_ID=s.guild.id;
 const replies:string[]=[];const msg:any={content:'!shop-setup preview',author:{id:OWNER_ID,bot:false},client:s.guild.client,guildId:null,webhookId:null,reply:async(x:any)=>{replies.push(x.content);}};
 await setup.handle({...msg,author:{id:'other',bot:false}});assert.equal(replies.length,0);
 await setup.handle({...msg,guildId:s.guild.id});assert.equal(replies.length,0);
 await setup.handle(msg);assert.equal(s.created(),0);assert.match(replies.join('\n'),/Сервер: Тестовый сервер/);
 s.member.permissions.has=()=>false;await setup.handle({...msg,content:'!shop-setup'});assert.match(replies.join('\n'),/Administrator/);assert.equal(s.created(),0);db.close();
});
test('Незавершённая операция восстанавливается по аудиту или останавливается без дублирования',async()=>{
 const {db,c}=fixture(),s=server(db,c),setup=new Setup(db,()=>c,new Panels(db,()=>c),async()=>{});const op=setup.begin('roles.seller');
 await assert.rejects(setup.recover(s.guild,'roles.seller','role'),/Незавершённая операция/);assert.equal(s.created(),0);
 const role=await s.guild.roles.create({name:'Seller'});s.guild.fetchAuditLogs=async()=>({entries:new Collection([['a',{reason:op,executorId:s.guild.client.user.id,targetId:role.id}]])});
 assert.equal((await setup.recover(s.guild,'roles.seller','role'))!.id,role.id);db.close();
});
test('Повторная и одновременная настройка не дублируют ресурсы; приватные каналы закрыты при создании',async()=>{
 const {db,c}=fixture();db.run('DELETE FROM resources');const s=server(db,c),panelCalls:string[]=[];
 const panels:any={keys:()=>['information'],all:async()=>{panelCalls.push('all');return ['information'];}};
 const setup=new Setup(db,()=>c,panels,async()=>{});process.env.GUILD_ID=s.guild.id;
 const replies:string[]=[];const msg:any={content:'!shop-setup',author:{id:OWNER_ID,bot:false},client:s.guild.client,guildId:null,webhookId:null,reply:async(x:any)=>{replies.push(x.content);}};
 await setup.handle(msg);assert.equal(db.value<any>('setupReport',{}).completed,true,replies.join('\n'));
 const initial=s.created();assert.equal(initial,10+c.structure.categories.length+c.structure.channels.length);
 await Promise.all([setup.handle(msg),setup.handle(msg)]);assert.equal(s.created(),initial);assert.equal(panelCalls.length,3);
 assert.equal(s.assigned.filter(x=>x===db.id('roles.admin')).length,1);assert.equal(s.assigned.filter(x=>x===db.id('roles.seller')).length,1);
 for(const key of ['adminChat','ticketLog','techLog','adminVoice']){const channel=s.channels.get(db.id('channels.'+key)!);const everyone=channel.permissionOverwrites.find((x:any)=>x.id===s.guild.id);assert.ok(everyone.deny.includes(P.ViewChannel));}
 const assignments=s.assigned.length;await setup.handle({...msg,content:'!shop-setup repair'});assert.equal(s.assigned.slice(assignments).includes(db.id('roles.admin')!),false);db.close();
});

test('Ошибка прав сообщает конкретный шаг и код Discord',()=>{assert.match(describeSetupError({code:50013},'расстановка ролей'),/расстановка ролей.*50013/);});
