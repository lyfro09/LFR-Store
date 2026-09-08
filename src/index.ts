import 'dotenv/config';
import { AuditLogEvent,Client,Events,GatewayIntentBits,Partials, type Guild } from 'discord.js';
import { openSync,closeSync,readFileSync,unlinkSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { loadConfig } from './core/config.js';
import { Store } from './core/db.js';
import { noMentions,box,payload,safeText,redactPublicText,colors } from './core/ui.js';
import { Catalog } from './modules/catalog.js';
import { updateDiscordCatalog } from './modules/catalog-updates.js';
import { Orders,statusNames } from './modules/orders.js';
import { Logs } from './modules/logs.js';
import { Tickets } from './modules/tickets.js';
import { Panels,buildPanel } from './modules/panels.js';
import { Setup } from './modules/setup.js';
import { Giveaways } from './modules/giveaways.js';
import { Reviews } from './modules/reviews.js';
import { Ranks } from './modules/roles.js';
import { Statistics } from './modules/statistics.js';
import { Router } from './router.js';
import { Outbox } from './modules/outbox.js';
import { VoiceKeeper } from './modules/voice.js';
import { auditActor } from './modules/audit-actor.js';
const discordToken=process.env.DISCORD_TOKEN?.trim()||process.env.BOT_TOKEN?.trim();
if(!discordToken)throw new Error('Заполните DISCORD_TOKEN или системную BOT_TOKEN.');
if(!process.env.GUILD_ID)throw new Error('Заполните GUILD_ID.');
let config=loadConfig();
const database=resolve(process.env.DATABASE_PATH||'data/shop.sqlite'),lockPath=resolve(process.env.LOCK_PATH||database+'.lock');mkdirSync(dirname(database),{recursive:true});mkdirSync(dirname(lockPath),{recursive:true});
try{const fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);}catch(e){
 if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
 const pid=Number(readFileSync(lockPath,'utf8'));try{process.kill(pid,0);throw new Error('Бот уже запущен (PID '+pid+'). Используйте один процесс на эту БД.');}catch(err){if((err as NodeJS.ErrnoException).code!=='ESRCH')throw err;}
 unlinkSync(lockPath);const fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
}
const db=new Store(database),catalog=new Catalog(db);catalog.seed();updateDiscordCatalog(catalog);const orders=new Orders(db),logs=new Logs(db),getConfig=()=>config;
const tickets=new Tickets(db,getConfig,orders,logs),panels=new Panels(db,getConfig),giveaways=new Giveaways(db,logs),reviews=new Reviews(db),ranks=new Ranks(db,getConfig),stats=new Statistics(db,getConfig,reviews,logs);
const router=new Router(db,getConfig,()=>{const next=loadConfig();for(const key of panels.keys())buildPanel(key,next,db);config=next;db.set('configSnapshot',config);},catalog,orders,tickets,panels,giveaways,reviews,ranks,logs);
const setup=new Setup(db,getConfig,panels,g=>stats.update(g,true));db.set('configSnapshot',config);
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.DirectMessages],partials:[Partials.Channel,Partials.Message],allowedMentions:noMentions});
let stopping=false;
const outbox=new Outbox(db);
const voice=new VoiceKeeper(e=>logs.error(e,'voice'));
async function worker(g:Guild) {
 if(stopping)return;
 await outbox.drain(async(job,data)=>{
    if(job.kind==='log')await logs.send(g,data.key,data.event??data.message);
    else if(job.kind==='orderStatus'){
     if(data.target==='completed')await ranks.automatic(g,data.user);
     const t=db.get('SELECT * FROM tickets WHERE id=?',data.ticket);
     if(t?.channel_id&&t.state!=='deleted'){await tickets.refresh(g,data.ticket);const c=await tickets.channel(g,data.ticket),accent=data.target==='completed'?colors.success:data.target==='cancelled'?colors.danger:colors.info;await c.send(payload(box([`## ${data.target==='completed'?'✅':data.target==='cancelled'?'✖️':'🔔'} Статус заказа изменён\n<@${data.user}>, заказ теперь **${statusNames[data.target]}**.\n\n-# Актуальные данные всегда указаны в основной карточке тикета.`],accent)));}
     await logs.send(g,'ticketLog',{title:'Статус заказа изменён',description:t?.channel_id&&t.state!=='deleted'?`<#${t.channel_id}>`:`Тикет #${String(data.ticket).padStart(6,'0')}`,color:data.target==='completed'?0x57f287:data.target==='cancelled'?0xed4245:0x5865f2,fields:[{name:'Покупатель',value:`<@${data.user}>`},{name:'Новый статус',value:`**${statusNames[data.target]}**`}]});
    }else if(job.kind==='giveawayResult'){
     await giveaways.publish(g,data.id);
     try{const u=await client.users.fetch(data.user),approved=data.status==='approved';await u.send(payload(box([`## ${approved?'✅ Участие одобрено':'✖️ Заявка отклонена'}\nЗаявка на розыгрыш **#${data.id}** обработана.${data.reason?'\n\n**Причина:** '+safeText(data.reason):''}\n\n-# Одобрение участия не означает победу в розыгрыше.`],approved?colors.success:colors.danger)));}catch(e){if((e as {code?:number}).code!==50007)throw e;db.audit('giveaway:'+data.id,'bot','dmUnavailable');}
    }
 });
}
client.on(Events.InteractionCreate,i=>{if(i.isRepliable())void router.handle(i).catch(e=>logs.error(e,'router'));});
client.on(Events.MessageCreate,m=>{void setup.handle(m).catch(e=>logs.error(e,'setup'));void reviews.capture(m).catch(e=>logs.error(e,'review-capture'));});
client.on(Events.GuildMemberAdd,m=>{if(m.guild.id!==process.env.GUILD_ID)return;logs.queue('joinLog',{title:'Участник присоединился',description:`<@${m.id}>`,color:0x57f287,fields:[{name:'Пользователь',value:safeText(m.user.tag)},{name:'Аккаунт создан',value:`<t:${Math.floor(m.user.createdTimestamp/1000)}:F> · <t:${Math.floor(m.user.createdTimestamp/1000)}:R>`},{name:'Участников на сервере',value:String(m.guild.memberCount)}]});const role=db.id('roles.member');if(role&&!m.user.bot)void m.roles.add(role).catch(e=>logs.error(e,'member-role'));});
client.on(Events.GuildMemberRemove,m=>{if(m.guild.id===process.env.GUILD_ID)logs.queue('joinLog',{title:'Участник вышел',description:`<@${m.id}>`,color:0xed4245,fields:[{name:'Пользователь',value:safeText(m.user.tag)},{name:'Участников осталось',value:String(m.guild.memberCount)}]});});
client.on(Events.VoiceStateUpdate,(_,state)=>{if(state.guild.id===process.env.GUILD_ID&&state.id===client.user?.id&&state.channelId!==process.env.VOICE_CHANNEL_ID)voice.reconnect();});
client.on(Events.GuildMemberUpdate,(old,m)=>{if(m.guild.id!==process.env.GUILD_ID)return;const before=new Set(old.roles.cache.keys()),after=new Set(m.roles.cache.keys()),added=[...after].filter(id=>!before.has(id)&&id!==m.guild.id),removed=[...before].filter(id=>!after.has(id)&&id!==m.guild.id);if(added.length||removed.length)void auditActor(m.guild,AuditLogEvent.MemberRoleUpdate,m.id).then(actor=>logs.queue('roleLog',{title:'Роли участника изменены',description:`<@${m.id}> · ${safeText(m.user.tag)}`,fields:[{name:'Кто изменил',value:actor},...(added.length?[{name:'Добавлены',value:added.map(id=>`<@&${id}>`).join(', ')}]:[]),...(removed.length?[{name:'Сняты',value:removed.map(id=>`<@&${id}>`).join(', ')}]:[])]}));});
client.on(Events.GuildRoleCreate,r=>{if(r.guild.id===process.env.GUILD_ID)void auditActor(r.guild,AuditLogEvent.RoleCreate,r.id).then(actor=>logs.queue('roleLog',{title:'Создана роль',description:`<@&${r.id}>`,color:r.color||0x9b59b6,fields:[{name:'Кто создал',value:actor},{name:'Название',value:safeText(r.name)},{name:'Цвет',value:r.hexColor}]}));});
client.on(Events.GuildRoleUpdate,(a,b)=>{if(b.guild.id!==process.env.GUILD_ID||!db.all('SELECT id FROM resources WHERE key LIKE \'roles.%\'').some(r=>r.id===b.id))return;const oldPerms=new Set(a.permissions.toArray()),newPerms=new Set(b.permissions.toArray()),added=[...newPerms].filter(x=>!oldPerms.has(x)),removed=[...oldPerms].filter(x=>!newPerms.has(x));void auditActor(b.guild,AuditLogEvent.RoleUpdate,b.id).then(actor=>logs.queue('roleLog',{title:'Служебная роль изменена',description:`<@&${b.id}>`,color:b.color||0x9b59b6,fields:[{name:'Кто изменил',value:actor},{name:'Название',value:`${safeText(a.name)} → ${safeText(b.name)}`},...(added.length?[{name:'Добавлены права',value:added.map(x=>`\`${x}\``).join(', ')}]:[]),...(removed.length?[{name:'Сняты права',value:removed.map(x=>`\`${x}\``).join(', ')}]:[]),...(!added.length&&!removed.length?[{name:'Изменение',value:'Обновлены оформление, позиция или параметры роли.'}]:[])]}));});
const publicChat=(id:string)=>['chat','offtopic'].some(k=>db.id('channels.'+k)===id);
client.on(Events.MessageUpdate,(a,b)=>{if(b.guildId===process.env.GUILD_ID&&publicChat(b.channelId)&&!b.author?.bot)logs.queue('messageLog',{title:'Сообщение изменено',description:`[Открыть сообщение](https://discord.com/channels/${b.guildId}/${b.channelId}/${b.id})`,color:0xfee75c,fields:[{name:'Автор',value:b.author?`<@${b.author.id}> · ${safeText(b.author.tag)}`:'Неизвестен'},{name:'Канал',value:`<#${b.channelId}>`},{name:'Было',value:safeText(redactPublicText(a.content??'[содержимое недоступно]')).slice(0,1400)},{name:'Стало',value:safeText(redactPublicText(b.content??'[содержимое недоступно]')).slice(0,1400)}]});});
client.on(Events.MessageDelete,m=>{if(m.guildId!==process.env.GUILD_ID)return;reviews.removed(m.id);if(publicChat(m.channelId)&&!m.author?.bot)logs.queue('messageLog',{title:'Сообщение удалено',description:'Discord не сообщает боту, кто выполнил удаление.',color:0xed4245,fields:[{name:'Автор',value:m.author?`<@${m.author.id}> · ${safeText(m.author.tag)}`:'Неизвестен'},{name:'Канал',value:`<#${m.channelId}>`},{name:'Содержимое',value:safeText(redactPublicText(m.content??'[содержимое недоступно]')).slice(0,2000)}]});});
client.on(Events.MessageBulkDelete,ms=>{for(const m of ms.values())if(m.guildId===process.env.GUILD_ID)reviews.removed(m.id);const first=ms.first();if(first&&publicChat(first.channelId))logs.queue('messageLog',{title:'Массовое удаление сообщений',description:'Discord не сообщает боту, кто выполнил удаление.',color:0xed4245,fields:[{name:'Канал',value:`<#${first.channelId}>`},{name:'Удалено сообщений',value:String(ms.size)}]});});
client.on(Events.ChannelDelete,c=>{if('guild' in c&&c.guild.id===process.env.GUILD_ID)db.run('UPDATE tickets SET state=\'deleted\' WHERE channel_id=?',c.id);});
client.on(Events.Error,e=>logs.error(e,'discord'));
let timer:NodeJS.Timeout|undefined;
client.once(Events.ClientReady,async()=>{
 console.log(`Бот подключён: ${client.user!.tag}. Целевой сервер: ${process.env.GUILD_ID}`);
 try{
  const g=await client.guilds.fetch(process.env.GUILD_ID!);
  if(process.env.VOICE_CHANNEL_ID)voice.start(g,process.env.VOICE_CHANNEL_ID);
  if(db.id('channels.reviews')&&!db.value('reviews.directPermissions.v1',false)){await reviews.configure(g);db.set('reviews.directPermissions.v1',true);}
  if(db.id('categories.tickets'))for(const t of db.all('SELECT * FROM tickets WHERE state IN (\'creating\',\'open\',\'closed\')'))try{await tickets.ensure(g,Number(t.id));}catch(e){logs.error(e,'ticket-recovery');}
  if(db.id('channels.reviews'))await stats.update(g,true);
  timer=setInterval(()=>{
   void worker(g).catch(e=>logs.error(e,'worker'));
   if(db.id('channels.statsMembers'))void stats.update(g).catch(e=>logs.error(e,'stats'));
  },30000);
  await worker(g);
 }catch(e){logs.error(e,'startup');}
});
function shutdown(){if(stopping)return;stopping=true;if(timer)clearInterval(timer);voice.stop();client.destroy();db.close();try{unlinkSync(lockPath);}catch{}process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
process.on('exit',()=>{try{if(readFileSync(lockPath,'utf8')===String(process.pid))unlinkSync(lockPath);}catch{}});
await client.login(discordToken);
