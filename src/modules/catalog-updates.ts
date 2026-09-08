import { readFileSync } from 'node:fs';
import { Catalog, productSchema } from './catalog.js';

// A one-time catalogue change: subsequent administrator edits are preserved.
export function updateDiscordCatalog(catalog: Catalog) {
 const db=catalog.db,key='catalog.discordVariants.v1';
 db.tx(()=>{
  if(db.value(key,false))return;
  const seed=JSON.parse(readFileSync('config/catalog.seed.json','utf8'));
  const before=db.all('SELECT id,data FROM products WHERE id IN (\'nitro\',\'decoration\',\'effect\')');
  for(const id of ['nitro','decoration']) {
   const target=productSchema.parse(seed.products.find((p:{id:string})=>p.id===id));
   const current=before.find(p=>p.id===id);
   // Do not recreate products deliberately removed by the administrator.
   if(!current)continue;
   const old=productSchema.parse(JSON.parse(current.data));
   catalog.saveProduct({...old,name:target.name,
    description:old.description.startsWith('Пример позиции.')?target.description:old.description,
    variantGroups:target.variantGroups,
    variants:target.variants.map(v=>{
     const existing=old.variants.find(x=>x.id===v.id);
     return {...v,price:existing?.price??null,available:existing?.available??false};
    })});
  }
  db.run('DELETE FROM products WHERE id=?','effect');
  db.audit('catalog','local-admin','discordVariantsUpdated',{before:before.map(p=>JSON.parse(p.data))});
 db.set(key,true);
 });
 const decorationKey='catalog.decorationOptions.v2';
 db.tx(()=>{
  if(db.value(decorationKey,false))return;
  const removedIds=new Set(['usd-5-99','usd-6-99','usd-7-99','usd-8-49','usd-10-99','usd-11-99','usd-12-99']);
  const row=db.get('SELECT data FROM products WHERE id=?','decoration');
  if(row){const before=productSchema.parse(JSON.parse(row.data));const removed=before.variants.filter(v=>removedIds.has(v.id));catalog.saveProduct({...before,variants:before.variants.filter(v=>!removedIds.has(v.id))});db.audit('product:decoration','local-admin','variantsRemoved',{removed});}
  db.set(decorationKey,true);
 });
}
