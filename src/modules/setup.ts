import { AuditLogEvent, ChannelType, PermissionFlagsBits as P, type Guild, type Message, type GuildChannel } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { OWNER_ID, type Config } from '../core/config.js';
import { Store, Serial, UserError } from '../core/db.js';
import { overwrites, roleOrder, rolePermissions, setupAllowed } from '../core/auth.js';
import type { Panels } from './panels.js';
import { noMentions,safeText } from '../core/ui.js';
import { planRolePositions,verifyRoleOrder } from './role-order.js';
export class Setup {
 readonly serial=new Serial();
 constructor(readonly db:Store,readonly config:()=>Config,readonly panels:Panels,readonly afterSetup:(g:Guild)=>Promise<void>) {}
 async handle(message:Message) {
  if(!/^!shop-setup(?:\s|$)/.test(message.content)||!setupAllowed(message.author.id,!!message.guildId,message.author.bot,message.webhookId))return;
  const reply=async(s:string)=>{for(let i=0;i<s.length;i+=1900)await message.reply({content:s.slice(i,i+1900),allowedMentions:noMentions});};
  const mode=message.content.trim().split(/\s+/)[1]??'apply';
  if(!['apply','preview','repair','status'].includes(mode)){await reply('## ⚠️ Неизвестный режим\nИспользование: `!shop-setup [preview|status|repair]`');return;}
  if(!process.env.GUILD_ID){await reply('## ⚠️ Сервер не указан\nЗаполните `GUILD_ID` в файле `.env`.');return;}
  await reply('## ⚙️ Настройка магазина\nПроверяю целевой сервер и сохранённое состояние…');
  await this.serial.run('setup',async()=>{
   let stage='проверка доступа к серверу';
   try {
    const guild=await message.client.guilds.fetch(process.env.GUILD_ID!);await guild.members.fetch(OWNER_ID);
    if(mode==='status') {const stats=this.db.value<any>('statistics',{}),report=this.db.value<any>('setupReport',{});await reply(`## 🩺 Состояние магазина\nСервер: ${guild.name} · \`${guild.id}\`\n**Ресурсов:** ${this.db.all('SELECT * FROM resources WHERE id IS NOT NULL').length}\n**Панелей:** ${this.db.all('SELECT * FROM panels WHERE message_id IS NOT NULL').length}\n\n### 📊 Статистика\nУчастников: **${stats.members??'—'}**\nОтзывов: **${stats.reviews??'—'}**\nСостояние: ${stats.lastError?'🔴 '+safeText(String(stats.lastError)):'🟢 работает'}\n\n### ⚙️ Последняя настройка\nЭтап: **${safeText(report.stage??'не запускалась')}**\nЗавершена: **${report.completed?'да':'нет'}**`);return; }
    stage='проверка прав и иерархии';
    await this.preflight(guild);
    const c=this.config();
    if(mode==='preview'){await reply(`## 👁️ Предпросмотр настройки\nСервер: ${guild.name} · \`${guild.id}\`\n\n**Роли:** ${roleOrder.map(k=>c.roles[k].name).join(' → ')}\n**Категории:** ${c.structure.categories.map(x=>x.name).join(', ')}\n**Каналы:** ${c.structure.channels.length}\n**Панели:** ${this.panels.keys().length}\n\n-# Будут применены сохранённые ID и явные bindings. Посторонние ресурсы не изменяются.`);return;}
    const report={guild:guild.id,created:[] as string[],updated:[] as string[],panels:[] as string[],errors:[] as string[],completed:false,stage};
    this.db.set('setupReport',report);
    const step=(name:string)=>{stage=name;report.stage=name;this.db.set('setupReport',report);};
    try {
     for(const [key,id] of Object.entries(c.bindings)) {if(!/^(roles|channels|categories)\./.test(key))throw new UserError('Некорректная привязка '+key);const old=this.db.id(key);if(old&&old!==id)throw new UserError('Привязка '+key+' уже имеет другой ID в БД.');this.db.bind(key,id);}
     for(const key of [...roleOrder].reverse()) {
      step('создание/обновление роли '+c.roles[key].name);
      const full='roles.'+key, existing=this.db.id(full);let role=existing?await missingAsNull(()=>guild.roles.fetch(existing),10011):null;
      const options={name:c.roles[key].name,permissions:rolePermissions(key),hoist:key!=='admin',mentionable:false,colors:{primaryColor:c.roles[key].color}};
      if(role&&(role.managed||role.id===guild.id))throw new UserError('Нельзя управлять интеграционной ролью или @everyone: '+full);
      if(!role){role=await this.recover(guild,full,'role') as any;if(!role){const reason=this.begin(full);role=await guild.roles.create({...options,reason});}this.db.bind(full,role!.id);report.created.push(full);}
      else {await role.edit(options);report.updated.push(full);}
      this.db.set('setupReport',report);
     }
     step('расстановка ролей');
     await guild.roles.fetch();
     const me=await guild.members.fetchMe({force:true});
     const positions=planRolePositions(guild.roles.cache.values(),me.roles.highest.id,this.db);
     if(positions.length)await guild.roles.setPositions(positions);
     const confirmedRoles=await guild.roles.fetch();
     verifyRoleOrder(confirmedRoles.values(),me.roles.highest.id,this.db);
     const golden=this.db.id('roles.golden')!;const discounts=this.db.value<Record<string,number>>('discounts',{});if(discounts[golden]===undefined){discounts[golden]=3;this.db.set('discounts',discounts);}
     step('назначение Admin и Seller владельцу');
     if(!this.db.value('initialOwnerAssignment',false)&&mode!=='repair') {const owner=await guild.members.fetch(OWNER_ID);await owner.roles.add(this.db.id('roles.admin')!);await owner.roles.add(this.db.id('roles.seller')!);this.db.set('initialOwnerAssignment',true);}
     for(const cat of c.structure.categories) {
      step('категория '+cat.name);
      const full='categories.'+cat.key;let channel=this.db.id(full)?await missingAsNull(()=>guild.channels.fetch(this.db.id(full)!),10003):null;
      const name=cat.key==='community'&&c.DISCORD_URL?new URL(c.DISCORD_URL).host+new URL(c.DISCORD_URL).pathname:cat.name;
      const permissions=overwrites(this.db,guild.id,me.id,cat.access);
      if(channel&&channel.guildId!==guild.id)throw new UserError('Ресурс принадлежит другому серверу: '+full);
      if(channel&&channel.type!==ChannelType.GuildCategory)throw new UserError('Неверный тип '+full);
      if(!channel){channel=await this.recover(guild,full,'channel') as any;if(!channel){const reason=this.begin(full);channel=await guild.channels.create({name,type:ChannelType.GuildCategory,permissionOverwrites:permissions,reason});}this.db.bind(full,channel!.id);report.created.push(full);}
      await channel!.edit({name,permissionOverwrites:permissions});this.db.set('setupReport',report);
     }
     for(const spec of c.structure.channels) {
      step('канал '+spec.name);
      const full='channels.'+spec.key;let channel=this.db.id(full)?await missingAsNull(()=>guild.channels.fetch(this.db.id(full)!),10003):null;
      const name=spec.key==='invite'&&c.DISCORD_URL?new URL(c.DISCORD_URL).host+new URL(c.DISCORD_URL).pathname:spec.name;
      const options={name:spec.key.startsWith('stats')&&channel?channel.name:name,parent:spec.parent?this.db.id('categories.'+spec.parent):null,permissionOverwrites:overwrites(this.db,guild.id,me.id,spec.access),...(spec.type===2?{userLimit:spec.userLimit}:{})};
      if(channel&&channel.guildId!==guild.id)throw new UserError('Ресурс принадлежит другому серверу: '+full);
      if(channel&&channel.type!==spec.type)throw new UserError('Неверный тип '+full);
      if(!channel){channel=await this.recover(guild,full,'channel') as any;if(!channel){const reason=this.begin(full);channel=await guild.channels.create({...options,type:spec.type,reason});}this.db.bind(full,channel!.id);report.created.push(full);}else report.updated.push(full);
      await channel!.edit(options);this.db.set('setupReport',report);
     }
     step('расстановка каналов');
     await guild.channels.setPositions([...c.structure.channels.filter(x=>!x.parent).map((x,i)=>({channel:this.db.id('channels.'+x.key)!,position:i})),...c.structure.categories.map((x,i)=>({channel:this.db.id('categories.'+x.key)!,position:i+2}))]);
     for(const cat of c.structure.categories)await guild.channels.setPositions(c.structure.channels.filter(x=>x.parent===cat.key).map((x,i)=>({channel:this.db.id('channels.'+x.key)!,position:i})));
     step('публикация панелей');
     report.panels=await this.panels.all(guild);
     await reply('## ⏳ Почти готово\nСтруктура и панели опубликованы. Назначаю базовую роль участникам и сверяю статистику…');
     step('назначение роли Участник');
     const members=await guild.members.fetch();for(const m of members.values())if(!m.user.bot&&!m.roles.cache.has(this.db.id('roles.member')!))await m.roles.add(this.db.id('roles.member')!);
     step('обновление статистики');
     await this.afterSetup(guild);report.completed=true;this.db.audit('setup',OWNER_ID,mode,report);this.db.enqueue('log',{key:'techLog',event:{title:mode==='setup'?'Настройка сервера завершена':'Восстановление сервера завершено',color:0x57f287,fields:[{name:'Инициатор',value:`<@${OWNER_ID}>`},{name:'Создано ресурсов',value:String(report.created.length)},{name:'Обновлено ресурсов',value:String(report.updated.length)},{name:'Опубликовано панелей',value:String(report.panels.length)}]}});
    }catch(e){report.errors.push(describeSetupError(e,stage));throw e;}finally{this.db.set('setupReport',report);}
    const stats=this.db.value<any>('statistics',{});await reply(`## ✅ Настройка завершена\nСервер: **${guild.name}** · \`${guild.id}\`\n\nСоздано ресурсов: **${report.created.length}**\nОбновлено ресурсов: **${report.updated.length}**\nОпубликовано панелей: **${report.panels.length}**\nУчастников: **${stats.members??'—'}**\nОтзывов: **${stats.reviews??'—'}**\n\nПодключены тикеты, роли, журналы и статистика.`);
   } catch(e) {this.db.audit('setup',OWNER_ID,'failed',{mode,stage,error:e instanceof Error?e.name:'Error',code:(e as {code?:number}).code});this.db.enqueue('log',{key:'techLog',event:{title:'Настройка сервера не завершена',color:0xed4245,description:'Подробное сообщение отправлено владельцу в личные сообщения.',fields:[{name:'Остановлено на шаге',value:safeText(stage)},{name:'Тип ошибки',value:`\`${safeText(e instanceof Error?e.name:'Error')}\``}]}});await reply('## ❌ Настройка не завершена\n'+describeSetupError(e,stage));}
  });
 }
 begin(key:string) {const op='shop:'+randomUUID();this.db.run('INSERT INTO resources(key,operation,started) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET id=NULL,operation=excluded.operation,started=excluded.started',key,op,Date.now());return op;}
 async recover(guild:Guild,key:string,kind:'role'|'channel') {
  const r=this.db.get('SELECT * FROM resources WHERE key=?',key);if(!r?.operation)return null;
  const entries=await guild.fetchAuditLogs({type:kind==='role'?AuditLogEvent.RoleCreate:AuditLogEvent.ChannelCreate,limit:100});
  const match=entries.entries.find(e=>e.reason===r.operation&&e.executorId===guild.client.user.id);
  if(match?.targetId)return kind==='role'?guild.roles.fetch(match.targetId):guild.channels.fetch(match.targetId);
  throw new UserError(`Незавершённая операция ${key} (${r.operation}). Автоматически подтвердить её результат нельзя. Проверьте аудит Discord и задайте точный ID в bindings; затем повторите repair. Повторный ресурс вслепую не создаётся.`);
 }
 async preflight(guild:Guild) {
  const me=await guild.members.fetchMe(),c=this.config();await guild.roles.fetch();await guild.channels.fetch();
  if(!me.permissions.has(P.Administrator))throw new UserError('Полная настройка роли Admin требует Administrator у бота. Выдайте временно и поднимите роль бота выше ролей магазина.');
  if(me.roles.highest.id===guild.id)throw new UserError('Поднимите роль бота выше остальных ролей сервера.');
  for(const k of roleOrder){const role=guild.roles.cache.get(this.db.id('roles.'+k)??c.bindings['roles.'+k]);if(role&&role.position>=me.roles.highest.position)throw new UserError('Роль '+role.name+' находится выше роли бота.');}
  const missingRoles=roleOrder.filter(k=>!guild.roles.cache.has(this.db.id('roles.'+k)??c.bindings['roles.'+k])).length;
  const missingChannels=[...c.structure.categories.map(x=>'categories.'+x.key),...c.structure.channels.map(x=>'channels.'+x.key)].filter(k=>!guild.channels.cache.has(this.db.id(k)??c.bindings[k])).length;
  if(guild.roles.cache.size+missingRoles>250||guild.channels.cache.size+missingChannels>500)throw new UserError('Недостаточно свободных ролей или каналов (250 / 500).');
 }
}

async function missingAsNull<T>(fn:()=>Promise<T>,code:number):Promise<T|null>{try{return await fn();}catch(e){if((e as {code?:number}).code===code)return null;throw e;}}

export function describeSetupError(error:unknown,stage:string) {
 const details=(error as {code?:number});
 if(details?.code===50013)return `Шаг «${stage}»: Discord отказал в правах (50013). Проверьте Administrator у бота и положение его роли выше управляемых ролей. Сохранённые ресурсы не потеряны; после исправления повторите !shop-setup.`;
 return `Шаг «${stage}»: ${error instanceof Error?error.message:String(error)}`;
}
