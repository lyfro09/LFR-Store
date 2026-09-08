import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { updateDiscordCatalog } from '../src/modules/catalog-updates.js';
import { Orders } from '../src/modules/orders.js';

test('Обновление каталога удаляет эффект, сохраняет старые заказы и применяется один раз',()=>{
 const {db,c,catalog}=fixture();
 catalog.saveProduct({...catalog.product('nitro'),id:'effect',name:'Эффект профиля',price:10000,available:true,terms:'Старые условия'});
 const orders=new Orders(db),q=catalog.quote('effect',undefined,[],c);
 orders.reserve('buyer','purchase',c,{},'old-session',q);
 const snapshot=db.get('SELECT data FROM orders')!.data;
 updateDiscordCatalog(catalog);
 assert.equal(catalog.products().some(p=>p.id==='effect'),false);
 assert.equal(db.get('SELECT data FROM orders')!.data,snapshot);
 assert.equal(catalog.product('nitro').variants.length,4);
 assert.equal(catalog.product('decoration').variants.length,9);
 assert.ok(catalog.product('decoration').variants.every(v=>v.price===null&&!v.available));
 const p=catalog.product('nitro');catalog.saveProduct({...p,name:'Мой Nitro',variants:p.variants.map(v=>({...v,price:34500,available:true}))});
 updateDiscordCatalog(catalog);assert.equal(catalog.product('nitro').name,'Мой Nitro');assert.equal(catalog.product('nitro').variants[0].price,34500);
 assert.equal(db.get('SELECT COUNT(*) n FROM history WHERE action=?','discordVariantsUpdated')!.n,1);db.close();
});
test('Каталог отклоняет дублирующиеся ID, неизвестные и пустые группы',()=>{
 const {db,catalog}=fixture();updateDiscordCatalog(catalog);const p=catalog.product('nitro');
 assert.throws(()=>catalog.saveProduct({...p,variants:[...p.variants,p.variants[0]]}));
 assert.throws(()=>catalog.saveProduct({...p,variantGroups:[...p.variantGroups,p.variantGroups[0]]}));
 assert.throws(()=>catalog.saveProduct({...p,variants:p.variants.map(v=>({...v,group:'missing'}))}));
 assert.throws(()=>catalog.saveProduct({...p,variants:p.variants.filter(v=>v.group==='full')}));
 assert.throws(()=>catalog.saveProduct({...p,variantGroups:[]}));db.close();
});
