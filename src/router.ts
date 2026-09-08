import { ButtonStyle, MessageFlags, MediaGalleryBuilder, MediaGalleryItemBuilder, type RepliableInteraction, type GuildMember, type Guild } from 'discord.js';
import { type Config,loadConfig } from './core/config.js';
import { Store,UserError,requireValue } from './core/db.js';
import { authorize,can } from './core/auth.js';
import { box,payload,row,button,menu,form,money,safeText,text,colors,pageNote } from './core/ui.js';
import { Catalog,variantLabel,type Product,type Category } from './modules/catalog.js';
import { Orders,statusNames } from './modules/orders.js';
import type { Tickets } from './modules/tickets.js';
import type { Panels } from './modules/panels.js';
import type { Giveaways } from './modules/giveaways.js';
import type { Reviews } from './modules/reviews.js';
import type { Ranks } from './modules/roles.js';
import type { Logs } from './modules/logs.js';
import { parseGiveawayUrl } from './modules/giveaways.js';
export class Router {
 constructor(readonly db:Store,readonly config:()=>Config,readonly reload:()=>void,readonly catalog:Catalog,readonly orders:Orders,readonly tickets:Tickets,readonly panels:Panels,readonly giveaways:Giveaways,readonly reviews:Reviews,readonly ranks:Ranks,readonly logs:Logs) {}
 async member(i:RepliableInteraction):Promise<GuildMember> {return i.guild!.members.fetch({user:i.user.id,force:true});}
 async ack(i:RepliableInteraction) {
  if(i.deferred||i.replied)return;
  const component=(i.isButton()||i.isStringSelectMenu())&&'message' in i&&i.message.flags.has(MessageFlags.Ephemeral);
  const modal=i.isModalSubmit()&&'isFromMessage' in i&&i.isFromMessage()&&i.message.flags.has(MessageFlags.Ephemeral);
  if(component||modal)await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});
 }
 async send(i:RepliableInteraction,b:ReturnType<typeof box>) {await this.ack(i);await i.editReply({...payload(b),flags:MessageFlags.IsComponentsV2});}
 async notice(i:RepliableInteraction,s:string,accent:number=colors.brand) {return this.send(i,box([s],accent));}
 productEditSession(sid:string,user:string) {
  const s=this.orders.readSession(sid,user),edit=s.catalogEdit;
  if(!edit||edit.kind!=='product')throw new UserError('Редактор товара устарел. Снова вызовите /product.');
  return {s,edit,p:this.catalog.product(edit.id)};
 }
 async saveVisualProduct(i:RepliableInteraction,sid:string,change:(p:Product)=>Product) {
  const m=await this.member(i);authorize(this.db,m,'sales');
  const {s,edit,p}=this.productEditSession(sid,i.user.id);
  const saved=this.db.tx(()=>{
   const current=this.catalog.product(edit.id);
   if(JSON.stringify(current)!==edit.original)throw new UserError('Товар изменился после открытия редактора. Снова вызовите /product.');
   const next=this.catalog.saveProduct(change(p));edit.original=JSON.stringify(next);this.orders.saveSession(sid,s);this.db.audit('product:'+p.id,m.id,'updated-visual');return next;
  });
  return saved;
 }
 async productEditor(i:RepliableInteraction,sid:string,note='') {
  const m=await this.member(i);authorize(this.db,m,'sales');const {p}=this.productEditSession(sid,i.user.id);
  const configured=p.variants.length?p.variants.filter(v=>v.price!==null&&v.available).length:p.price!==null?1:0;
  const problems=[!p.enabled&&'товар скрыт',!p.available&&'общее наличие выключено',!p.terms.trim()&&'условия не заполнены',p.variants.length&&!configured&&'нет доступных вариантов с ценой'].filter(Boolean).join(', ');
  const b=box([`## ⚙️ ${safeText(p.name)}\n-# Визуальный редактор товара · ID: \`${p.id}\``,`### 📋 Основные данные\nКатегория: **${safeText(this.catalog.categories().find(c=>c.id===p.category)?.name??p.category)}**\nПубликация: ${p.enabled?'🟢 включена':'⚪ выключена'}\nОбщее наличие: ${p.available?'🟢 есть':'🔴 нет'}\nВыдача: **${p.delivery==='subscriptions'?'Nitro и подписки':'обычная'}**`,`### 💳 Продажа\n${p.variants.length?`Готовые варианты: **${configured}/${p.variants.length}**`:`Цена: **${p.price===null?'не указана':money(p.price,p.currency)}**`}\nУсловия: **${p.terms.trim()?'заполнены':'не заполнены'}**${problems?`\n\n⚠️ Заказ недоступен: ${problems}.`:''}${note?'\n\n✅ '+safeText(note):''}`],problems?colors.warning:colors.success);
  b.addActionRowComponents(row(button(`pa-main:${sid}`,'Название и описание'),button(`pa-terms:${sid}`,'Условия покупки')));
  b.addActionRowComponents(row(button(`pa-enabled:${sid}`,p.enabled?'Скрыть товар':'Показать товар',p.enabled?ButtonStyle.Secondary:ButtonStyle.Success),button(`pa-available:${sid}`,p.available?'Нет в наличии':'Есть в наличии',p.available?ButtonStyle.Secondary:ButtonStyle.Success),button(`pa-delivery:${sid}`,p.delivery==='subscriptions'?'Выдача: подписки':'Выдача: обычная')));
  const cats=this.catalog.categories().slice(0,25);if(cats.length)b.addActionRowComponents(menu(`pa-category:${sid}`,'Переместить в категорию',cats.map(c=>({label:c.name,value:c.id,description:c.id===p.category?'Текущая категория':c.description}))));
  if(p.variants.length)b.addActionRowComponents(menu(`pa-variant-open:${sid}`,'Настроить вариант и цену',p.variants.map(v=>({label:variantLabel(p,v),value:v.id,description:v.price===null?'Цена не указана':`${money(v.price,p.currency)} · ${v.available?'доступен':'выключен'}`}))));
  else b.addActionRowComponents(row(button(`pa-price:${sid}`,'Цена и валюта')));
  await this.send(i,b);
 }
 async productVariantEditor(i:RepliableInteraction,sid:string,id:string,note='') {
  const m=await this.member(i);authorize(this.db,m,'sales');const {p}=this.productEditSession(sid,i.user.id),v=requireValue(p.variants.find(x=>x.id===id),'Вариант не найден.');
  const b=box([`## ⚙️ ${safeText(p.name)}\n-# Настройка отдельного варианта`,`### 📦 ${safeText(variantLabel(p,v))}\nЦена продажи: **${v.price===null?'не указана':money(v.price,p.currency)}**\nДоступность: ${v.available?'🟢 включена':'🔴 выключена'}${note?'\n\n✅ '+safeText(note):''}`],v.available&&v.price!==null?colors.success:colors.warning);
  b.addActionRowComponents(row(button(`pa-variant-form:${sid}:${v.id}`,'Название и цена',ButtonStyle.Primary),button(`pa-variant-toggle:${sid}:${v.id}`,v.available?'Выключить':'Включить',v.available?ButtonStyle.Secondary:ButtonStyle.Success),button(`pa-back:${sid}`,'← К товару')));await this.send(i,b);
 }
 priceInput(raw:string) {
  if(!raw.trim())return null;const normalized=raw.trim().replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))throw new UserError('Цена должна быть числом, например 350 или 350,50.');
  const value=Math.round(Number(normalized)*100);if(value>1_000_000_000)throw new UserError('Цена слишком большая.');return value;
 }
 categoryEditSession(sid:string,user:string) {
  const s=this.orders.readSession(sid,user),edit=s.catalogEdit;if(!edit||edit.kind!=='category')throw new UserError('Редактор категории устарел. Снова вызовите /category.');
  const c=requireValue(this.catalog.categories().find(x=>x.id===edit.id),'Категория не найдена.');return {s,edit,c};
 }
 async saveVisualCategory(i:RepliableInteraction,sid:string,change:(c:Category)=>Category) {
  const m=await this.member(i);authorize(this.db,m,'sales');const {s,edit,c}=this.categoryEditSession(sid,i.user.id);
  const saved=this.db.tx(()=>{const current=requireValue(this.catalog.categories().find(x=>x.id===edit.id),'Категория не найдена.');if(JSON.stringify(current)!==edit.original)throw new UserError('Категория изменилась после открытия редактора. Снова вызовите /category.');const next=this.catalog.saveCategory(change(c));edit.original=JSON.stringify(next);this.orders.saveSession(sid,s);this.db.audit('category:'+c.id,m.id,'updated-visual');return next;});return saved;
 }
 async categoryEditor(i:RepliableInteraction,sid:string,note='') {
  const m=await this.member(i);authorize(this.db,m,'sales');const {c}=this.categoryEditSession(sid,i.user.id),count=this.catalog.products(c.id).length;
  const b=box([`## ⚙️ ${safeText(c.emoji)} ${safeText(c.name)}\n-# Визуальный редактор категории · ID: \`${c.id}\``,`Порядок в каталоге: **${c.position}**\nПубликация: ${c.enabled?'🟢 включена':'⚪ выключена'}\nТоваров внутри: **${count}**\n\n${safeText(c.description)||'Описание не заполнено.'}${note?'\n\n✅ '+safeText(note):''}`],c.enabled?colors.success:colors.warning);
  b.addActionRowComponents(row(button(`ca-main:${sid}`,'Название и оформление',ButtonStyle.Primary),button(`ca-enabled:${sid}`,c.enabled?'Скрыть категорию':'Показать категорию',c.enabled?ButtonStyle.Secondary:ButtonStyle.Success)));await this.send(i,b);
 }
 async categories(i:RepliableInteraction,mode:string,page=0) {
  await this.ack(i);const categories=this.catalog.categories().filter(c=>c.enabled),slice=categories.slice(page*25,page*25+25);
  let discount='';if(mode==='order'){const m=await this.member(i),d=this.catalog.discount(m.roles.cache.keys());discount=d.percent?`\n\n🏷️ Ваша скидка: **${d.percent}%** · <@&${d.role}>`:'\n\n🏷️ Ваша скидка: **0%**';}
  const pages=Math.ceil(categories.length/25),b=box([`## ${mode==='order'?'🛒 Оформление заказа':'📦 Каталог товаров'}\nВыберите категорию, чтобы перейти к товарам.${discount}\n\n${pageNote(page+1,pages)}`],colors.brand);
  if(slice.length)b.addActionRowComponents(menu('category:'+mode,'Выберите категорию',slice.map(c=>({label:c.name,value:c.id,description:c.description,...(c.emoji?{emoji:c.emoji}:{})}))));else b.addTextDisplayComponents(text('Категории пока не добавлены.'));
  const nav=[];if(page>0)nav.push(button(`categories:${mode}:${page-1}`,'← Назад'));if((page+1)*25<categories.length)nav.push(button(`categories:${mode}:${page+1}`,'Далее →'));if(nav.length)b.addActionRowComponents(row(...nav));
  await this.send(i,b);
 }
 async list(i:RepliableInteraction,category:string,mode:string,page=0) {
  const cat=this.catalog.categories().find(c=>c.id===category&&c.enabled);if(!cat)throw new UserError('Категория недоступна.');
  const all=this.catalog.products(category).filter(p=>p.enabled),items=all.slice(page*25,page*25+25);
  const b=box([`## ${safeText(cat.emoji||'📦')} ${safeText(cat.name)}\n${safeText(cat.description)||'Выберите товар из списка.'}\n\n${items.length?`${all.length} товаров · ${pageNote(page+1,Math.ceil(all.length/25)).replace('-# ','')}`:'-# Товары пока не добавлены.'}`]);
  if(items.length)b.addActionRowComponents(menu('product:'+mode,'Выберите товар',items.map(p=>({label:p.name,value:p.id,description:!p.available?'Нет в наличии':p.variants.length?'Есть варианты — откройте карточку':p.price===null?'Цена пока не настроена':money(p.price,p.currency)}))));
  const nav=[button(`categories:${mode}:0`,'← Категории')];if(page>0)nav.push(button(`list:${mode}:${category}:${page-1}`,'Предыдущие'));if((page+1)*25<all.length)nav.push(button(`list:${mode}:${category}:${page+1}`,'Следующие'));b.addActionRowComponents(row(...nav));await this.send(i,b);
 }
 async card(i:RepliableInteraction,id:string,sid?:string) {
  const p=this.catalog.product(id);if(!p.enabled||!this.catalog.categories().some(c=>c.id===p.category&&c.enabled))throw new UserError('Товар недоступен.');
  if(p.variants.length&&!sid)return this.startOrder(i,id,'view');
  const s=sid?this.orders.readSession(sid,i.user.id):undefined;
  if(s&&s.product!==id)throw new UserError('Сессия относится к другому товару.');
  const v=s?p.variants.find(v=>v.id===s.variant):undefined;
  if(s&&(!v||(p.variantGroups.length&&v.group!==s.variantGroup)))throw new UserError('Выберите вариант товара заново.');
  const price=v?v.price:p.price,available=p.available&&(!v||v.available);
  const c=this.config(),enabled=p.enabled&&available&&!!p.terms.trim()&&price!==null,b=box([`## 📦 ${safeText(p.name)}${v?' · '+safeText(variantLabel(p,v)):''}\n${safeText(p.description)||'Описание товара скоро появится.'}`,`### 💳 Цена и наличие\nЦена: **${price===null?'не настроена':money(price,p.currency)}**\nСтатус: ${available?'🟢 **в наличии**':'🔴 **недоступен**'}`,`### 🚚 Выдача и гарантия\n${p.delivery==='usual'?'Обычное время выдачи':'Nitro и подписки'}: **${c.delivery[p.delivery]}**${p.delivery==='subscriptions'?'\n'+c.delivery.delay:''}\nГарантия: **${c.delivery.guarantee}**`,`### 📌 Условия\n${safeText(p.terms)||'Условия покупки пока не заполнены.'}\n\n-# ${c.delivery.video}\n-# ${c.delivery.refund}`],enabled?colors.success:colors.warning);
  if(p.image)b.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(p.image)));
  b.addActionRowComponents(row(button(sid?'order-selected:'+sid:'buy:'+p.id,'🛒 Заказать',ButtonStyle.Primary,!enabled),button(sid?'variants:'+sid:'list:view:'+p.category+':0','← Назад')));await this.send(i,b);
 }
 async startOrder(i:RepliableInteraction,id:string,mode:'view'|'order'='order') {
  const p=this.catalog.product(id);
  if(!p.enabled||!this.catalog.categories().some(c=>c.id===p.category&&c.enabled))throw new UserError('Товар недоступен.');
  const s=this.orders.session(i.user.id,this.config().tickets.sessionMinutes,{product:id,mode});
  if(p.variantGroups.length)await this.variantGroups(i,s);else if(p.variants.length)await this.variants(i,s);else await this.summary(i,s,true);
 }
 async variantGroups(i:RepliableInteraction,sid:string):Promise<void> {
  const s=this.orders.readSession(sid,i.user.id),p=this.catalog.product(s.product!);
  if(!p.variantGroups.length)return this.variants(i,sid);
  s.variantGroup=undefined;s.variant=undefined;s.quote=undefined;this.orders.saveSession(sid,s);
  const b=box([`## 🧩 ${safeText(p.name)}\n-# Шаг 1 из 2`,`### Выберите тип подписки\nНа следующем шаге вы сможете выбрать способ получения.`]);
  b.addActionRowComponents(menu('variant-group:'+sid,'Выберите тип',p.variantGroups.map(g=>({label:g.name,value:g.id}))));
  b.addActionRowComponents(row(button(`list:${s.mode??'order'}:${p.category}:0`,'← Товары'),button('cancel:'+sid,'Отмена',ButtonStyle.Danger)));await this.send(i,b);
 }
 async variants(i:RepliableInteraction,sid:string):Promise<void> {
  const s=this.orders.readSession(sid,i.user.id),p=this.catalog.product(s.product!);
  const group=p.variantGroups.find(g=>g.id===s.variantGroup);
  if(p.variantGroups.length&&!group)return this.variantGroups(i,sid);
  s.variant=undefined;s.quote=undefined;this.orders.saveSession(sid,s);
  const b=box([`## 🧩 ${safeText(p.name)}${group?' · '+safeText(group.name):''}\n-# ${group?'Шаг 2 из 2':'Выбор варианта'}`,`### ${group?'Выберите способ получения':'Выберите подходящий вариант'}\nЦена и доступность указаны в списке ниже.`]);
  const variants=p.variants.filter(v=>!group||v.group===group.id);
  if(variants.length)b.addActionRowComponents(menu('variant:'+sid,group?'Выберите способ получения':'Выберите вариант',variants.map(v=>({label:v.name,value:v.id,description:v.price===null?'Цена продажи не настроена':`${money(v.price,p.currency)} · ${v.available?'в наличии':'недоступен'}`}))));
  b.addActionRowComponents(row(button(group?'variant-groups:'+sid:`list:${s.mode??'order'}:${p.category}:0`,group?'← Тип Nitro':'← Товары'),button('cancel:'+sid,'Отмена',ButtonStyle.Danger)));await this.send(i,b);
 }
 async selectVariant(i:RepliableInteraction,sid:string,value:string) {
  const s=this.orders.readSession(sid,i.user.id),p=this.catalog.product(s.product!),v=p.variants.find(v=>v.id===value);
  if(!v||(p.variantGroups.length&&(!s.variantGroup||v.group!==s.variantGroup)))throw new UserError('Сначала выберите тип, затем способ получения в этой группе.');
  s.variant=v.id;s.quote=undefined;this.orders.saveSession(sid,s);
  if(s.mode!=='view'&&p.available&&v.available&&v.price!==null&&p.terms.trim())await this.summary(i,sid,true);
  else await this.card(i,p.id,sid);
 }
 async summary(i:RepliableInteraction,sid:string,update=false,note='') {
  await this.ack(i);const s=this.orders.readSession(sid,i.user.id),m=await this.member(i);
  if(update){s.quote=this.catalog.quote(s.product!,s.variant,m.roles.cache.keys(),this.config());this.orders.saveSession(sid,s);}
  const q=requireValue(s.quote,'Выберите товар заново.');
  const b=box([`## 🛒 Подтверждение заказа\n-# Проверьте данные перед созданием приватного тикета${note?'\n\n⚠️ '+safeText(note):''}`,`### 📦 ${safeText(q.name)}${q.variantName?' · '+safeText(q.variantName):''}\nОбычная цена: ${money(q.price,q.currency)}\nСкидка: **${q.discount}%** · −${money(q.discountAmount,q.currency)}\n## К оплате: ${money(q.total,q.currency)}`,`### 🚚 Получение\n${q.deliveryKind==='usual'?'Обычное время выдачи':'Nitro и подписки'}: **${q.delivery}**${q.deliveryKind==='subscriptions'?'\n'+q.delay:''}\nГарантия: **${q.guarantee}**`,`### 📌 Условия заказа\n${safeText(q.terms)}\n\nКомментарий: **${safeText(s.comment||'не указан')}**\nПравила: <#${this.db.id('channels.rules')}>\n\n-# ${q.video}\n-# ${q.refund}`],note?colors.warning:colors.brand);
  b.addActionRowComponents(row(button('confirm:'+sid,'✅ Создать заказ',ButtonStyle.Success),button('comment:'+sid,'✏️ Комментарий')),row(button((this.catalog.product(s.product!).variants.length?'variants:'+sid:'card:'+s.product),'← Назад'),button('cancel:'+sid,'Отмена',ButtonStyle.Danger)));await this.send(i,b);
 }
 async confirm(i:RepliableInteraction,sid:string) {
  await this.ack(i);const s=this.orders.readSession(sid,i.user.id);
  const old=this.db.get('SELECT ticket_id FROM orders WHERE session_id=? AND user_id=?',sid,i.user.id);
  if(old){const c=await this.tickets.ensure(i.guild!,Number(old.ticket_id));return this.notice(i,`Заказ уже создан: <#${c.id}>.`);}
  const m=await this.member(i),q=this.catalog.quote(s.product!,s.variant,m.roles.cache.keys(),this.config());
  if(JSON.stringify(q)!==JSON.stringify(s.quote)){s.quote=q;this.orders.saveSession(sid,s);return this.summary(i,sid,false,'Цена, привилегия или условия изменились. Проверьте новый итог и подтвердите ещё раз.');}
  const r=this.orders.reserve(i.user.id,'purchase',this.config(),{comment:s.comment??''},sid,q),c=await this.tickets.ensure(i.guild!,r.id);
  await this.notice(i,`${r.existing?'У вас уже есть активный тикет':'Заказ создан'}: <#${c.id}>.`);
 }
 async listOrders(i:RepliableInteraction,staff:boolean,page=0) {
  const records=staff?this.db.all('SELECT * FROM orders ORDER BY id DESC LIMIT 11 OFFSET ?',page*10):this.db.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 11 OFFSET ?',i.user.id,page*10);
  const icons:Record<string,string>={pending:'🕓',paid:'💳',working:'⚙️',completed:'✅',cancelled:'✖️'},items=records.slice(0,10).map(o=>{const q=JSON.parse(o.data),t=this.db.get('SELECT channel_id,state FROM tickets WHERE id=?',o.ticket_id);return `${icons[o.status]??'•'} **#${o.id} · ${safeText(q.name)}**\n${statusNames[o.status]} · **${money(q.total,q.currency)}**${t?.channel_id&&t.state!=='deleted'?` · <#${t.channel_id}>`:''}`;});
  const b=box([`## ${staff?'📋 Заказы магазина':'🛍️ Мои заказы'}\n-# ${staff?'Последние операции покупателей':'История ваших покупок'}`,items.join('\n\n')||'### 💤 Заказов пока нет\nОформить покупку можно через панель тикетов.',pageNote(page+1,page+(records.length>10?2:1))]);
  const nav=[];if(page>0)nav.push(button(`orders:${staff?'staff':'mine'}:${page-1}`,'← Назад'));if(records.length>10)nav.push(button(`orders:${staff?'staff':'mine'}:${page+1}`,'Далее →'));if(nav.length)b.addActionRowComponents(row(...nav));await this.send(i,b);
 }
 async reviewList(i:RepliableInteraction,_page=0) {await this.notice(i,`## ⭐ Отзывы покупателей\nНапишите отзыв обычным сообщением в <#${this.db.id('channels.reviews')}>.\n\nПубликовать отзывы могут владельцы рангов **Bronze**, **Golden** и **Diamond**.`,colors.info);}
 async giveawayList(i:RepliableInteraction,page=0) {const m=await this.member(i),staff=can(this.db,m.id,m.roles.cache.keys(),'staff');const records=staff?this.db.all('SELECT * FROM giveaways ORDER BY id DESC LIMIT 11 OFFSET ?',page*10):this.db.all('SELECT * FROM giveaways WHERE user_id=? ORDER BY id DESC LIMIT 11 OFFSET ?',i.user.id,page*10),status:Record<string,string>={pending:'🟡 На проверке',approved:'🟢 Одобрено',rejected:'🔴 Отклонено'};const b=box(['## 🎁 Заявки на розыгрыши\n-# История ручной проверки',records.slice(0,10).map(r=>{const data=JSON.parse(r.data);return `**#${r.id}** · ${status[r.status]} · [сообщение](${r.url})${data.reason?'\nПричина: '+safeText(data.reason):''}`;}).join('\n\n')||'### 💤 Заявок пока нет',pageNote(page+1,page+(records.length>10?2:1))]);const nav=[];if(page>0)nav.push(button('giveaways:'+(page-1),'← Назад'));if(records.length>10)nav.push(button('giveaways:'+(page+1),'Далее →'));if(nav.length)b.addActionRowComponents(row(...nav));await this.send(i,b);}
 async handle(i:RepliableInteraction) {
  if(i.guildId!==process.env.GUILD_ID||!i.guild){await this.notice(i,'Команды магазина доступны только на настроенном сервере.');return;}
  try {
   if(i.isChatInputCommand()) {
    const name=i.commandName;
    if(name==='support')return void await i.showModal(form('support-submit','💬 Поддержка',[{id:'subject',label:'Тема',max:100},{id:'description',label:'Описание вопроса',long:true,max:1500}]));
    if(name==='product'){
     const m=await this.member(i);authorize(this.db,m,'sales');const id=i.options.getString('id',true);if(!/^[a-z0-9_-]{1,40}$/.test(id))throw new UserError('ID: латиница, цифры, _ и -, до 40 символов.');
     let existing=this.catalog.products().find(p=>p.id===id);if(!existing){const category=this.catalog.categories()[0];if(!category)throw new UserError('Сначала создайте категорию.');existing=this.catalog.saveProduct({id,name:'Новый товар',description:'',category:category.id,image:'',variantGroups:[],variants:[],price:null,currency:'RUB',available:false,delivery:'usual',terms:'',enabled:false});this.db.audit('product:'+id,m.id,'created-visual');}
     const sid=this.orders.session(i.user.id,30,{catalogEdit:{kind:'product',id,original:JSON.stringify(existing)}});return void await this.productEditor(i,sid);
    }
    if(name==='category'){
     const m=await this.member(i);authorize(this.db,m,'sales');const id=i.options.getString('id',true);if(!/^[a-z0-9_-]{1,40}$/.test(id))throw new UserError('ID: латиница, цифры, _ и -, до 40 символов.');let existing=this.catalog.categories().find(c=>c.id===id);if(!existing){existing=this.catalog.saveCategory({id,name:'Новая категория',description:'',emoji:'📦',position:this.catalog.categories().length,enabled:false});this.db.audit('category:'+id,m.id,'created-visual');}const sid=this.orders.session(i.user.id,30,{catalogEdit:{kind:'category',id,original:JSON.stringify(existing)}});return void await this.categoryEditor(i,sid);
    }
    if(name==='ticket'){const m=await this.member(i),id=i.options.getInteger('id',true),action=i.options.getString('action',true);this.tickets.access(m,id,action!=='close');if(['close','delete'].includes(action))return void await i.showModal(form(`ticket-reason:${action}:${id}`,action==='close'?'Закрыть тикет?':'Удалить канал тикета?',[{id:'reason',label:'Причина (отправка подтверждает действие)',long:true,max:500}]));await this.ack(i);if(['add','remove'].includes(action)){const u=i.options.getUser('user');if(!u)throw new UserError('Укажите участника.');await this.tickets.participant(i.guild,m,id,u.id,action==='remove');}else await this.tickets.act(i.guild,m,id,action);return void await this.notice(i,'Действие выполнено.');}
    if(name==='review'){const m=await this.member(i),order=i.options.getInteger('order',true),action=i.options.getString('action',true);authorize(this.db,m,action==='import'?'admin':'moderation');if(action==='remove')return void await i.showModal(form('review-remove:'+order,'Удаление отзыва',[{id:'reason',label:'Причина',long:true,max:500}]));await this.ack(i);await this.reviews.import(i.guild,m,order,requireValue(i.options.getString('message'),'Укажите ID сообщения.'));return void await this.notice(i,'Отзыв импортирован.');}
    await this.ack(i);
    if(name==='myorders')return void await this.listOrders(i,false,(i.options.getInteger('page')??1)-1);
    if(name==='giveaway')return void await this.giveawayList(i,(i.options.getInteger('page')??1)-1);
    const m=await this.member(i);
    if(name==='panel'){const key=i.options.getString('name',true);authorize(this.db,m,['products','news','giveaways','freebies','cases'].includes(key)?'sales':'admin');this.reload();if(key==='all')await this.panels.all(i.guild);else await this.panels.publish(i.guild,key);this.db.audit('panels',m.id,'updated',{key});return void await this.notice(i,'Панели обновлены.');}
    if(name==='discount'){authorize(this.db,m,'admin');const r=i.options.getRole('role',true),percent=i.options.getInteger('percent',true),rules=this.db.value<Record<string,number>>('discounts',{});rules[r.id]=percent;this.db.set('discounts',rules);this.db.audit('discount',m.id,'updated',{role:r.id,percent});return void await this.notice(i,`Скидка <@&${r.id}>: ${percent}%.`);}
    if(name==='order'){authorize(this.db,m,'staff');return void await this.listOrders(i,true,(i.options.getInteger('page')??1)-1);}
    if(name==='rank'){await this.ranks.manual(m,await i.guild.members.fetch(i.options.getUser('user',true).id),i.options.getString('rank',true));return void await this.notice(i,'Ранг назначен.');}
    if(name==='diagnostics'){authorize(this.db,m,'diagnostics');const s=this.db.value<any>('statistics',{}),queued=this.db.get('SELECT COUNT(*) n FROM outbox')!.n,last=s.checkedAt?`<t:${Math.floor(s.checkedAt/1000)}:R>`:'ещё не выполнялась';return void await this.notice(i,`## 🩺 Диагностика магазина\n-# Текущее состояние служб бота\n\n### 🤖 Discord\nПодключение: 🟢 **активно**\nОчередь заданий: **${queued}**\n\n### 📊 Статистика\nУчастников: **${s.members??'—'}**\nОтзывов: **${s.reviews??'—'}**\nПоследняя проверка: **${last}**\nСостояние: ${s.lastError?'🔴 **ошибка** — '+safeText(String(s.lastError)):'🟢 **работает**'}`,s.lastError?colors.danger:colors.success);}
    throw new UserError('Неизвестная команда.');
   }
   if(i.isModalSubmit()) {
    await this.ack(i);const [action,a,b,editSession]=i.customId.split(':');
    const field=(id:string)=>i.fields.getTextInputValue(id).trim();
    if(action==='ca-main'){
     const position=Number(field('position'));if(!Number.isInteger(position)||position<0)throw new UserError('Порядок должен быть целым неотрицательным числом.');
     await this.saveVisualCategory(i,a,c=>({...c,name:field('name'),description:field('description'),emoji:field('emoji'),position}));return void await this.categoryEditor(i,a,'Категория сохранена.');
    }
    if(action==='pa-main'){
     const p=await this.saveVisualProduct(i,a,p=>({...p,name:field('name'),description:field('description'),image:field('image')}));return void await this.productEditor(i,a,`Данные «${p.name}» сохранены.`);
    }
    if(action==='pa-terms'){
     await this.saveVisualProduct(i,a,p=>({...p,terms:field('terms')}));return void await this.productEditor(i,a,'Условия покупки сохранены.');
    }
    if(action==='pa-price'){
     const currency=field('currency').toUpperCase();await this.saveVisualProduct(i,a,p=>({...p,price:this.priceInput(field('price')),currency}));return void await this.productEditor(i,a,'Цена сохранена.');
    }
    if(action==='pa-variant-form'){
     await this.saveVisualProduct(i,a,p=>({...p,variants:p.variants.map(v=>v.id===b?{...v,name:field('name'),price:this.priceInput(field('price'))}:v)}));return void await this.productVariantEditor(i,a,b,'Вариант сохранён.');
    }
    if(action==='support-submit'){const r=this.orders.reserve(i.user.id,'support',this.config(),{subject:field('subject'),description:field('description')});const c=await this.tickets.ensure(i.guild,r.id);return void await this.notice(i,`${r.existing?'У вас уже есть активный тикет':'Тикет создан'}: <#${c.id}>.`);}
    if(action==='giveaway-ticket-submit'){const parsed=parseGiveawayUrl(field('url')),r=this.orders.reserve(i.user.id,'support',this.config(),{type:'giveaway-prize',giveawayUrl:parsed.url});const c=await this.tickets.ensure(i.guild,r.id);return void await this.notice(i,`${r.existing?'У вас уже есть активный тикет выдачи':'Тикет для получения выигрыша создан'}: <#${c.id}>.`);}
    if(action==='comment-submit'){const s=this.orders.readSession(a,i.user.id);s.comment=field('comment');this.orders.saveSession(a,s);return void await this.summary(i,a);}
    if(action==='ticket-reason'){await this.tickets.act(i.guild,await this.member(i),Number(b),a,field('reason'));return void await this.notice(i,'Действие выполнено.');}
    if(action==='order-cancel'){const m=await this.member(i);authorize(this.db,m,'sales');this.tickets.access(m,Number(a),true);this.orders.transition(Number(a),m.id,'cancelled',field('reason'),field('settlement'));await this.tickets.refresh(i.guild,Number(a));return void await this.notice(i,'Заказ отменён. Результат ручного урегулирования сохранён.');}
    if(action==='giveaway-reject'){await this.giveaways.decide(i.guild,await this.member(i),Number(a),'rejected',field('reason'));return void await this.notice(i,'Заявка отклонена.');}
    if(action==='review-submit')return void await this.notice(i,`Отзывы теперь публикуются обычным сообщением в <#${this.db.id('channels.reviews')}> пользователями с рангом Bronze, Golden или Diamond.`);
    if(action==='review-remove'){await this.reviews.moderate(i.guild,await this.member(i),Number(a),field('reason'));return void await this.notice(i,'Отзыв снят с публикации.');}
    if(action==='edit'){
     const m=await this.member(i);authorize(this.db,m,'sales');
     if(!editSession)throw new UserError('Форма устарела. Заново вызовите /product или /category; изменения не сохранены.');
     const session=this.orders.readSession(editSession,i.user.id),edit=session.catalogEdit;
     if(!edit||edit.kind!==a||edit.id!==b)throw new UserError('Форма не соответствует товару или категории. Откройте её заново.');
     let data;try{data=JSON.parse(field('json'));}catch{throw new UserError('Некорректный JSON. Изменения не сохранены.');}
     if(data.id!==b)throw new UserError('ID нельзя менять в форме.');
     this.db.tx(()=>{
      const current=a==='product'?this.catalog.products().find(p=>p.id===b):this.catalog.categories().find(c=>c.id===b);
      if(JSON.stringify(current??null)!==edit.original)throw new UserError('Настройки изменились после открытия формы. Откройте её заново, чтобы получить актуальные данные.');
      if(a==='product')this.catalog.saveProduct(data);else this.catalog.saveCategory(data);
      session.cancelled=true;this.orders.saveSession(editSession,session);this.db.audit(a+':'+b,m.id,'updated');
     });
     if(a==='category')await this.panels.publish(i.guild,'products');return void await this.notice(i,'Настройки сохранены в БД.');
    }
    throw new UserError('Форма устарела. Повторите действие.');
   }
   if(i.isButton()||i.isStringSelectMenu()) {
    const [action,a,b,d]=i.customId.split(':');const value=i.isStringSelectMenu()?i.values[0]:'';
    if(action==='ca-main'){const m=await this.member(i);authorize(this.db,m,'sales');const {c}=this.categoryEditSession(a,i.user.id);return void await i.showModal(form(`ca-main:${a}`,'Настройка категории',[{id:'name',label:'Название',value:c.name,max:100},{id:'description',label:'Краткое описание',value:c.description,required:false,max:100},{id:'emoji',label:'Эмодзи',value:c.emoji,required:false,max:64},{id:'position',label:'Порядок в списке (0 — первая)',value:String(c.position),max:6}]));}
    if(action==='pa-main'){const m=await this.member(i);authorize(this.db,m,'sales');const {p}=this.productEditSession(a,i.user.id);return void await i.showModal(form(`pa-main:${a}`,'Название и описание',[{id:'name',label:'Название',value:p.name,max:100},{id:'description',label:'Описание',value:p.description,long:true,required:false,max:800},{id:'image',label:'HTTPS-ссылка на изображение',value:p.image,required:false,max:1000}]));}
    if(action==='pa-terms'){const m=await this.member(i);authorize(this.db,m,'sales');const {p}=this.productEditSession(a,i.user.id);return void await i.showModal(form(`pa-terms:${a}`,'Условия покупки',[{id:'terms',label:'Что получает покупатель и на какой срок',value:p.terms,long:true,required:false,max:500}]));}
    if(action==='pa-price'){const m=await this.member(i);authorize(this.db,m,'sales');const {p}=this.productEditSession(a,i.user.id);return void await i.showModal(form(`pa-price:${a}`,'Цена товара',[{id:'price',label:'Цена продажи (например 350 или 350,50)',value:p.price===null?'':String(p.price/100),required:false,max:20},{id:'currency',label:'Валюта: RUB, USD или EUR',value:p.currency,max:3}]));}
    if(action==='pa-variant-form'){const m=await this.member(i);authorize(this.db,m,'sales');const {p}=this.productEditSession(a,i.user.id),v=requireValue(p.variants.find(x=>x.id===b),'Вариант не найден.');return void await i.showModal(form(`pa-variant-form:${a}:${b}`,'Настройка варианта',[{id:'name',label:'Название варианта',value:v.name,max:100},{id:'price',label:'Цена продажи (например 350 или 350,50)',value:v.price===null?'':String(v.price/100),required:false,max:20}]));}
    if(action==='support')return void await i.showModal(form('support-submit','💬 Поддержка',[{id:'subject',label:'Тема',max:100},{id:'description',label:'Описание вопроса',long:true,max:1500}]));
    if(action==='giveaway'&&!a)return void await i.showModal(form('giveaway-ticket-submit','🎁 Получение выигрыша',[{id:'url',label:'Ссылка на сообщение о выигрыше',placeholder:'https://discord.com/channels/…',max:200}]));
    if(action==='comment'){const s=this.orders.readSession(a,i.user.id);return void await i.showModal(form('comment-submit:'+a,'Комментарий к заказу',[{id:'comment',label:'Комментарий (не присылайте пароли)',value:s.comment,required:false,long:true,max:500}]));}
    if(action==='ticket'&&['close','delete'].includes(a)){const m=await this.member(i);this.tickets.access(m,Number(b),a==='delete');return void await i.showModal(form(`ticket-reason:${a}:${b}`,a==='close'?'Закрыть тикет?':'Удалить канал тикета?',[{id:'reason',label:'Причина (отправка подтверждает действие)',long:true,max:500}]));}
    if(action==='order'&&a==='cancelled'){authorize(this.db,await this.member(i),'sales');return void await i.showModal(form('order-cancel:'+b,'Отмена заказа',[{id:'reason',label:'Причина отмены',long:true,max:500},{id:'settlement',label:'Результат ручного урегулирования оплаты',long:true,required:false,max:500}]));}
    if(action==='giveaway'&&a==='rejected'){authorize(this.db,await this.member(i),'staff');return void await i.showModal(form('giveaway-reject:'+b,'Отклонение заявки',[{id:'reason',label:'Причина',long:true,max:500}]));}
    if(action==='review-order')return void await this.notice(i,`Отзывы теперь публикуются обычным сообщением в <#${this.db.id('channels.reviews')}>.`);
    await this.ack(i);
    if(action==='ca-enabled'){await this.saveVisualCategory(i,a,c=>({...c,enabled:!c.enabled}));return void await this.categoryEditor(i,a,'Публикация категории изменена.');}
    if(action==='pa-enabled'){await this.saveVisualProduct(i,a,p=>({...p,enabled:!p.enabled}));return void await this.productEditor(i,a,'Публикация товара изменена.');}
    if(action==='pa-available'){await this.saveVisualProduct(i,a,p=>({...p,available:!p.available}));return void await this.productEditor(i,a,'Общее наличие изменено.');}
    if(action==='pa-delivery'){await this.saveVisualProduct(i,a,p=>({...p,delivery:p.delivery==='usual'?'subscriptions':'usual'}));return void await this.productEditor(i,a,'Тип выдачи изменён.');}
    if(action==='pa-category'){if(!this.catalog.categories().some(c=>c.id===value))throw new UserError('Категория не найдена.');await this.saveVisualProduct(i,a,p=>({...p,category:value}));return void await this.productEditor(i,a,'Категория изменена.');}
    if(action==='pa-variant-open')return void await this.productVariantEditor(i,a,value);
    if(action==='pa-variant-toggle'){await this.saveVisualProduct(i,a,p=>({...p,variants:p.variants.map(v=>v.id===b?{...v,available:!v.available}:v)}));return void await this.productVariantEditor(i,a,b,'Доступность варианта изменена.');}
    if(action==='pa-back')return void await this.productEditor(i,a);
    if(action==='browse')return void await this.categories(i,'view');
    if(action==='checkout')return void await this.categories(i,'order');
    if(action==='categories')return void await this.categories(i,a,Number(b));
    if(action==='category')return void await this.list(i,value,a);
    if(action==='list')return void await this.list(i,b,a,Number(d));
    if(action==='product')return void await (a==='order'?this.startOrder(i,value):this.card(i,value));
    if(action==='card')return void await this.card(i,a);
    if(action==='buy')return void await this.startOrder(i,a);
    if(action==='variants')return void await this.variants(i,a);
    if(action==='variant-groups')return void await this.variantGroups(i,a);
    if(action==='variant-group'){const s=this.orders.readSession(a,i.user.id),p=this.catalog.product(s.product!);if(!p.variantGroups.some(g=>g.id===value))throw new UserError('Тип товара не найден.');s.variantGroup=value;s.variant=undefined;s.quote=undefined;this.orders.saveSession(a,s);return void await this.variants(i,a);}
    if(action==='order-selected'){const s=this.orders.readSession(a,i.user.id),p=this.catalog.product(s.product!),v=p.variants.find(v=>v.id===s.variant);if(!v||(p.variantGroups.length&&v.group!==s.variantGroup))throw new UserError('Выберите вариант заново.');s.mode='order';this.orders.saveSession(a,s);return void await this.summary(i,a,true);}
    if(action==='variant')return void await this.selectVariant(i,a,value);
    if(action==='confirm')return void await this.confirm(i,a);
    if(action==='cancel'){const s=this.orders.readSession(a,i.user.id);s.cancelled=true;this.orders.saveSession(a,s);return void await this.notice(i,'Оформление отменено. Уже созданные заказы остаются в «Моих заказах».');}
    if(action==='ticket'){await this.tickets.act(i.guild,await this.member(i),Number(b),a);return void await this.notice(i,'Действие выполнено.');}
    if(action==='order'){const m=await this.member(i);authorize(this.db,m,'sales');this.tickets.access(m,Number(b),true);this.orders.transition(Number(b),m.id,a);await this.tickets.refresh(i.guild,Number(b));return void await this.notice(i,'Статус заказа обновлён.');}
    if(action==='orders'){if(a==='staff')authorize(this.db,await this.member(i),'staff');return void await this.listOrders(i,a==='staff',Number(b));}
    if(action==='review'||action==='reviews')return void await this.notice(i,`Напишите отзыв обычным сообщением в <#${this.db.id('channels.reviews')}>. Писать могут владельцы рангов Bronze, Golden и Diamond.`);
    if(action==='giveaway'){if(a!=='approved')throw new UserError('Неизвестное действие.');await this.giveaways.decide(i.guild,await this.member(i),Number(b),'approved');return void await this.notice(i,'Участие одобрено.');}
    if(action==='giveaways')return void await this.giveawayList(i,Number(a));
    throw new UserError('Кнопка устарела. Откройте панель заново.');
   }
  } catch(e) {
   const msg=e instanceof UserError?e.message:(e as {name?:string}).name==='ZodError'?'Некорректные настройки. Проверьте поля и ограничения в README.':'Не удалось выполнить действие. Проверьте доступ бота и повторите попытку; ошибка записана в технический журнал.';
   if(!(e instanceof UserError))this.logs.error(e,'interaction');
   try{await this.notice(i,`## ⚠️ Не удалось выполнить действие\n${msg}`,colors.danger);}catch{this.logs.error(new Error(),'interaction-response');}
  }
 }
}
