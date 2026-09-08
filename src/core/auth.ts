import { PermissionFlagsBits as P, type GuildMember, type OverwriteResolvable } from 'discord.js';
import type { Store } from './db.js';
import { UserError } from './db.js';
import { OWNER_ID } from './config.js';
export type Capability = 'admin'|'sales'|'staff'|'diagnostics'|'moderation';
export function can(db:Store, userId:string, roleIds:Iterable<string>, cap:Capability) {
  const roles=new Set(roleIds);
  if(userId===OWNER_ID || roles.has(db.id('roles.admin')??'')) return true;
  const keys={admin:[],sales:['seller'],staff:['seller','manager'],diagnostics:['developer'],moderation:['manager']}[cap];
  return keys.some(k=>roles.has(db.id('roles.'+k)??''));
}
export function authorize(db:Store,m:GuildMember,cap:Capability) { if(!can(db,m.id,m.roles.cache.keys(),cap)) throw new UserError('У вас нет прав для этого действия.'); }
export function setupAllowed(author:string, inGuild:boolean, bot:boolean, webhook:unknown) { return author===OWNER_ID && !inGuild && !bot && !webhook; }
export const roleOrder=['admin','seller','developer','manager','sponsor','partner','diamond','golden','bronze','member'];
export const rolePermissions=(key:string) => key==='admin' ? P.Administrator : key==='manager' ? P.ModerateMembers : 0n;
const read=[P.ViewChannel,P.ReadMessageHistory,P.UseApplicationCommands];
const write=[P.SendMessages,P.AttachFiles,P.EmbedLinks,P.AddReactions];
const noWrite=[P.SendMessages,P.CreatePublicThreads,P.CreatePrivateThreads,P.SendMessagesInThreads];
export function overwrites(db:Store,guildId:string,botId:string,access:string,author?:string,closed=false,extra:string[]=[]):OverwriteResolvable[] {
  const out:OverwriteResolvable[]=[{id:guildId,allow:[],deny:[P.ViewChannel]},{id:botId,allow:[...read,...write,P.ManageChannels,P.ManageMessages,P.ManageRoles,P.Connect,P.Speak,...(access==='tickets'?[P.MentionEveryone]:[])],deny:[]}];
  const add=(key:string,allow:bigint[],deny:bigint[]=[])=>{ const id=db.id('roles.'+key); if(id)out.push({id,allow,deny}); };
  add('admin',[...read,...write,P.Connect,P.Speak]);
  const publicAccess=['readonly','store','reviews','chat','voice','stats'].includes(access);
  if(publicAccess) {
    out[0]={id:guildId,allow:[...read,...(access==='chat'?write:[]),...(access==='voice'?[P.Connect,P.Speak,P.UseVAD,P.Stream]:[])],deny:access==='stats'?[P.Connect,...noWrite]:access==='voice'||access==='chat'?[]:noWrite};
    if(access==='store') add('seller',write);
    if(access==='reviews')for(const rank of ['bronze','golden','diamond'])add(rank,write);
    if(['chat','reviews'].includes(access)) add('manager',[P.ManageMessages]);
    if(access==='voice') add('manager',[P.MoveMembers,P.MuteMembers,P.DeafenMembers]);
  } else {
    const keys:Record<string,string[]>={tickets:['seller','manager'],technical:['developer'],staff:['seller','manager'],moderation:['manager'],moderator:['manager'],admin:[]};
    for(const k of keys[access]??[])add(k,[...read,...(['tickets','moderator'].includes(access)?write:[])]);
    for(const id of [...new Set([...(author?[author]:[]),...extra])])out.push({id,type:1,allow:[...read,...(!closed?write:[])],deny:closed?noWrite:[]});
  }
  return out;
}
