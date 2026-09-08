import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Store } from '../core/db.js';
import { requireValue, UserError } from '../core/db.js';
import type { Config } from '../core/config.js';
const ident=z.string().regex(/^[a-z0-9_-]{1,40}$/);
export const categorySchema=z.object({id:ident,name:z.string().min(1).max(100),description:z.string().max(100),emoji:z.string().max(64),position:z.int().min(0),enabled:z.boolean()});
const price=z.int().min(0).max(1_000_000_000).nullable();
export const productSchema=z.object({id:ident,name:z.string().min(1).max(100),description:z.string().max(800),category:ident,image:z.union([z.literal(''),z.url().refine(s=>s.startsWith('https://'))]),variantGroups:z.array(z.object({id:ident,name:z.string().min(1).max(100)})).max(25).default([]),variants:z.array(z.object({id:ident,name:z.string().min(1).max(100),group:ident.optional(),price,available:z.boolean()})).max(25),price,currency:z.string().regex(/^[A-Z]{3}$/).refine(s=>{try {return Intl.supportedValuesOf('currency').includes(s)&&new Intl.NumberFormat('ru',{style:'currency',currency:s}).resolvedOptions().maximumFractionDigits===2;}catch{return false;}}),available:z.boolean(),delivery:z.enum(['usual','subscriptions']),terms:z.string().max(500),enabled:z.boolean()}).superRefine((p,ctx)=>{
 if(new Set(p.variants.map(v=>v.id)).size!==p.variants.length)ctx.addIssue({code:'custom',path:['variants'],message:'ID вариантов должны быть уникальными.'});
 const groups=new Set(p.variantGroups.map(g=>g.id));
 if(groups.size!==p.variantGroups.length)ctx.addIssue({code:'custom',path:['variantGroups'],message:'ID групп должны быть уникальными.'});
 for(const [index,v] of p.variants.entries())if(groups.size?!v.group||!groups.has(v.group):!!v.group)ctx.addIssue({code:'custom',path:['variants',index,'group'],message:'Укажите существующую группу варианта.'});
 for(const g of groups)if(!p.variants.some(v=>v.group===g))ctx.addIssue({code:'custom',path:['variantGroups'],message:'У каждой группы должен быть хотя бы один вариант.'});
});
export type Product=z.infer<typeof productSchema>;
export type Category=z.infer<typeof categorySchema>;
export class Catalog {
 constructor(readonly db:Store) {}
 seed() { const seed=JSON.parse(readFileSync('config/catalog.seed.json','utf8')); this.db.tx(()=>{
   if(this.db.value('catalogSeeded',false))return;
   for(const x of seed.categories) { const c=categorySchema.parse(x); this.db.run('INSERT OR IGNORE INTO categories VALUES (?,?)',c.id,JSON.stringify(c)); }
   for(const x of seed.products) { const p=productSchema.parse(x); this.db.run('INSERT OR IGNORE INTO products VALUES (?,?)',p.id,JSON.stringify(p)); }
   this.db.set('catalogSeeded',true);
 }); }
 categories() { return this.db.all('SELECT data FROM categories').map(r=>categorySchema.parse(JSON.parse(r.data))).sort((a,b)=>a.position-b.position); }
 products(category?:string) { return this.db.all('SELECT data FROM products').map(r=>productSchema.parse(JSON.parse(r.data))).filter(p=>!category||p.category===category).sort((a,b)=>a.id.localeCompare(b.id)); }
 product(id:string) { return productSchema.parse(JSON.parse(requireValue(this.db.get('SELECT data FROM products WHERE id=?',id),'Товар не найден.').data)); }
 saveProduct(input:unknown) { const p=productSchema.parse(input); if(!this.categories().some(c=>c.id===p.category))throw new UserError('Категория не найдена.'); this.db.run('INSERT INTO products VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',p.id,JSON.stringify(p)); return p; }
 saveCategory(input:unknown) { const c=categorySchema.parse(input); this.db.run('INSERT INTO categories VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',c.id,JSON.stringify(c)); return c; }
 quote(id:string,variant:string|undefined,roles:Iterable<string>,c:Config) {
   const p=this.product(id),v=variant?p.variants.find(x=>x.id===variant):undefined;
   if(!p.enabled||!p.available||!this.categories().some(x=>x.id===p.category&&x.enabled))throw new UserError('Товар сейчас недоступен.');
   if(p.variants.length&&!v)throw new UserError('Выберите вариант товара.');
   const price=v?v.price:p.price;
   if(price===null||!p.terms.trim()||(v&&!v.available))throw new UserError('Цена, наличие или условия товара ещё не настроены.');
   const discount=this.discount(roles),amount=Math.floor((price*discount.percent+50)/100);
   return {productId:p.id,name:p.name,variantId:v?.id??'',variantName:v?variantLabel(p,v):'',price,discount:discount.percent,discountAmount:amount,total:price-amount,currency:p.currency,terms:p.terms,deliveryKind:p.delivery,delivery:c.delivery[p.delivery],delay:c.delivery.delay,guarantee:c.delivery.guarantee,video:c.delivery.video,refund:c.delivery.refund};
 }
 discount(roles:Iterable<string>) { const rules=this.db.value<Record<string,number>>('discounts',{}); let best={percent:0,role:''}; for(const role of roles)if((rules[role]??0)>best.percent)best={percent:rules[role],role}; return best; }
}
export type Quote=ReturnType<Catalog['quote']>;

export function variantLabel(p:Product,v:Product['variants'][number]) {const group=p.variantGroups.find(g=>g.id===v.group);return group?group.name+' · '+v.name:v.name;}
