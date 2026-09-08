import type { Guild, GuildMember } from 'discord.js';
import type { Store } from '../core/db.js';
import { UserError,Serial } from '../core/db.js';
import type { Config } from '../core/config.js';
import { authorize } from '../core/auth.js';
export class Ranks {
 readonly serial=new Serial();
 constructor(readonly db:Store,readonly config:()=>Config) {}
 async assign(member:GuildMember,rank:string,actor:string,onlyPromote=false) {
  return this.serial.run(member.id,async()=>{
  member=await member.guild.members.fetch({user:member.id,force:true});
  if(!['bronze','golden','diamond'].includes(rank))throw new UserError('Можно назначить только Bronze, Golden или Diamond.');
  const id=this.db.id('roles.'+rank),base=this.db.id('roles.member');if(!id||!base)throw new UserError('Сначала настройте сервер.');
  const rankIds=['bronze','golden','diamond'].map(k=>this.db.id('roles.'+k)!);
  // Add/remove exact roles so unrelated roles are never overwritten by a stale cache.
  if(onlyPromote){const current=rankIds.findIndex(r=>member.roles.cache.has(r));if(rankIds.indexOf(id)<=current)return;}
  await member.roles.add(id);await member.roles.add(base);for(const old of rankIds)if(old!==id&&member.roles.cache.has(old))await member.roles.remove(old);
  this.db.audit('member:'+member.id,actor,'rank',{rank});this.db.enqueue('log',{key:'roleLog',event:{title:'Покупательский ранг назначен',description:`<@${member.id}>`,color:0x57f287,fields:[{name:'Новый ранг',value:`<@&${id}>`},{name:'Кто изменил',value:actor===member.guild.client.user.id?`<@${actor}> · автоматическое повышение`:`<@${actor}>`}]}});
  });
 }
 async manual(actor:GuildMember,member:GuildMember,rank:string) {authorize(this.db,actor,'admin');await this.assign(member,rank,actor.id);}
 async automatic(g:Guild,user:string) {const c=this.config(),thresholds=c.ranks.thresholds;const amount=Number(this.db.get('SELECT COALESCE(SUM(amount),0) total FROM spend WHERE user_id=? AND currency=?',user,c.ranks.currency)?.total??0);let selected='';for(const rank of ['bronze','golden','diamond'] as const)if(thresholds[rank]!==undefined&&amount>=thresholds[rank]!)selected=rank;if(selected){const m=await g.members.fetch(user);const current=['bronze','golden','diamond'].findIndex(r=>m.roles.cache.has(this.db.id('roles.'+r)??''));if(['bronze','golden','diamond'].indexOf(selected)>current)await this.assign(m,selected,g.client.user.id,true);}}
}
