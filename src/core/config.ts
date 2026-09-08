import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Store } from './db.js';
export const OWNER_ID = '689455809612349463';
const str = z.string().max(3500);
const contact = z.string().max(300);
const optionalUrl = z.union([z.literal(''),z.url().refine(x => x.startsWith('https://'), 'Нужна ссылка https://')]);
const access = z.enum(['voice','stats','readonly','tickets','chat','admin','store','reviews','technical','staff','moderation','moderator']);
export const configSchema = z.object({
  SHOP_NAME:z.string().min(1).max(100), DISCORD_URL:optionalUrl, TELEGRAM_URL:optionalUrl, PARTNERSHIP_CONTACT:contact, START_YEAR:z.string().regex(/^(|\d{4})$/),
  appearance:z.object({accent:z.string().regex(/^#[0-9a-f]{6}$/i),banners:z.object({information:str,rules:str,tickets:str,products:str})}),
  delivery:z.object({usual:str,subscriptions:str,delay:str,guarantee:str,video:str,refund:str,penalty:str}), paymentInstructions:str,
  tickets:z.object({activePerType:z.int().min(1).max(10),cooldownSeconds:z.int().min(0),sessionMinutes:z.int().min(1).max(1440)}),
  statistics:z.object({includeBots:z.boolean(),intervalMinutes:z.number().min(10)}),
  ranks:z.object({currency:z.string().length(3),thresholds:z.object({bronze:z.int().min(0).optional(),golden:z.int().min(0).optional(),diamond:z.int().min(0).optional()})}),
  bindings:z.record(z.string(),z.string().regex(/^\d{17,20}$/)), roles:z.record(z.string(),z.object({name:z.string().min(1).max(100),color:z.int().min(0).max(0xffffff)})),
  information:z.object({welcome:str,order:str,guarantees:str,safety:str,contactsTitle:str,seller:str,partnership:str,discord:str,telegram:str,why:str,year:str,support:str,thanks:str}),
  rules:z.object({title:str,intro:str,itemTitle:str,items:z.array(str).length(8)}), texts:z.record(z.string(),str),
  structure:z.object({categories:z.array(z.object({key:z.string(),name:z.string().max(100),access})),channels:z.array(z.object({key:z.string(),name:z.string().max(100),parent:z.string().nullable(),access,type:z.union([z.literal(0),z.literal(2)]),userLimit:z.int().min(0).max(99)}))})
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(): Config {
  const input = JSON.parse(readFileSync(process.env.CONFIG_PATH || 'config/shop.json','utf8'));
  for (const k of ['SHOP_NAME','DISCORD_URL','TELEGRAM_URL','PARTNERSHIP_CONTACT','START_YEAR']) if (process.env[k]?.trim()) input[k] = process.env[k]!.trim();
  const c=configSchema.parse(input);
  for(const role of ['admin','seller','developer','manager','sponsor','partner','diamond','golden','bronze','member'])if(!c.roles[role])throw new Error('Не настроена роль '+role);
  for(const keys of [c.structure.categories.map(x=>x.key),c.structure.channels.map(x=>x.key)])if(new Set(keys).size!==keys.length)throw new Error('Повторяющийся ключ структуры сервера.');
  for(const channel of c.structure.channels)if(channel.parent&&!c.structure.categories.some(x=>x.key===channel.parent))throw new Error('Неизвестная родительская категория: '+channel.parent);
  return c;
}
export function variables(c:Config, db:Store): Record<string,string> {
  const channel = (k:string) => { const id=db.id('channels.'+k); if(!id) throw new Error('Не настроен channels.'+k); return `<#${id}>`; };
  const seller=db.id('roles.seller'); if(!seller) throw new Error('Не настроена roles.seller');
  return { SHOP_NAME:c.SHOP_NAME,DISCORD_URL:c.DISCORD_URL,TELEGRAM_URL:c.TELEGRAM_URL,PARTNERSHIP_CONTACT:c.PARTNERSHIP_CONTACT,START_YEAR:c.START_YEAR,PRODUCTS_CHANNEL:channel('products'),TICKETS_CHANNEL:channel('tickets'),RULES_CHANNEL:channel('rules'),SELLER_ROLE:`<@&${seller}>`, USUAL_DELIVERY:c.delivery.usual,SUBSCRIPTIONS_DELIVERY:c.delivery.subscriptions,DELAY:c.delivery.delay,GUARANTEE:c.delivery.guarantee,VIDEO:c.delivery.video,REFUND:c.delivery.refund,PENALTY:c.delivery.penalty };
}
export function template(text:string, vars:Record<string,string>) { return text.replace(/\{([A-Z_]+)\}/g,(_,k:string) => { if (!(k in vars)) throw new Error('Неизвестная переменная: '+k); return vars[k]; }); }
