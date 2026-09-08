import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, AttachmentBuilder, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type MessageCreateOptions } from 'discord.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export const noMentions = { parse: [] as ('users'|'roles'|'everyone')[], repliedUser: false };
export const colors = {
  brand: 0x793cff,
  info: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  neutral: 0x99aab5
} as const;
export const text = (s:string) => new TextDisplayBuilder().setContent(s);
export const separator = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
export const button = (id:string,label:string,style:ButtonStyle=ButtonStyle.Secondary,disabled=false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
export const row = (...b:ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(b);
export function menu(id:string, placeholder:string, options:{label:string,value:string,description?:string,emoji?:string}[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options));
}
export function box(blocks:string[],accent:number=colors.brand) {
  const b=new ContainerBuilder().setAccentColor(accent);
  blocks.filter(Boolean).forEach((s,i)=> { if(i) b.addSeparatorComponents(separator()); b.addTextDisplayComponents(text(s)); }); return b;
}
export function payload(container:ContainerBuilder, ephemeral=false): MessageCreateOptions & { flags:number } {
  validateComponents([container.toJSON()]);
  return { flags:MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),components:[container],allowedMentions:noMentions };
}
export function validateComponents(components:unknown[]) {
  let count=0, chars=0;
  function visit(v:any) { if(v.id!==undefined&&(!Number.isInteger(v.id)||v.id<0||v.id>0x7fffffff))throw new Error('ID компонента должен быть целым числом от 0 до 2147483647.'); count++; if(v.type===10) chars+=v.content.length; if(v.components) v.components.forEach(visit); if(v.accessory) visit(v.accessory); }
  components.forEach(visit); if(count>40 || chars>4000) throw new Error(`Панель превышает лимит Discord: ${count}/40 компонентов, ${chars}/4000 символов. Сократите тексты в настройках.`);
}
export function banner(container:ContainerBuilder,path:string,key:string):AttachmentBuilder[] {
  if(!path) return [];
  const full=resolve(path); if(!existsSync(full)) throw new Error('Не найден баннер: '+path);
  const name=key+'.png'; container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://'+name)));
  return [new AttachmentBuilder(full,{name})];
}
export function form(id:string,title:string, fields:{id:string,label:string,value?:string,placeholder?:string,required?:boolean,long?:boolean,max?:number}[]) {
  const m=new ModalBuilder().setCustomId(id).setTitle(title);
  for(const f of fields) {
    const input=new TextInputBuilder().setCustomId(f.id).setStyle(f.long?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(f.required??true).setMaxLength(f.max??1000);
    if(f.value) input.setValue(f.value); if(f.placeholder) input.setPlaceholder(f.placeholder);
    m.addLabelComponents(new LabelBuilder().setLabel(f.label).setTextInputComponent(input));
  }
  return m;
}
export const safeText = (s:string) => s.replace(/@/g,'@\u200b').replace(/</g,'‹').replace(/([*_`~|\\])/g,'\\$1');
export const money = (n:number,currency:string) => new Intl.NumberFormat('ru-RU',{style:'currency',currency,minimumFractionDigits:2}).format(n/100);
export const pageNote = (current:number,total:number) => `-# Страница ${current} из ${Math.max(1,total)}`;

export function redactPublicText(s:string) {return s.replace(/https?:\/\/(?:www\.)?(?:discord\.gift|discord(?:app)?\.com\/gifts)\/[^\s]+/gi,'[подарочная ссылка скрыта]').replace(/[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}/g,'[токен скрыт]').replace(/mfa\.[A-Za-z0-9_-]{20,}/g,'[токен скрыт]').replace(/(?:\d[ -]?){12,19}/g,'[номер скрыт]').replace(/(?:пароль|password|token|токен|код[ -]?(?:подарка|активации))\s*[:=]\s*\S+/gi,'[секрет скрыт]');}
