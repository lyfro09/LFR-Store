import 'dotenv/config';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../src/core/db.js';
import { Catalog } from '../src/modules/catalog.js';
const [action,file]=process.argv.slice(2);
if(!file||!['import','export'].includes(action))throw new Error('Укажите import/export и путь к JSON.');
const path=resolve(process.env.DATABASE_PATH||'data/shop.sqlite');
if(existsSync(path+'.lock'))throw new Error('Сначала остановите бота: обнаружен файл блокировки.');
const db=new Store(path),catalog=new Catalog(db);catalog.seed();
try{
 if(action==='import'){const input=JSON.parse(readFileSync(file,'utf8'));db.tx(()=>{for(const c of input.categories??[])catalog.saveCategory(c);for(const p of input.products??[])catalog.saveProduct(p);db.audit('catalog','local-admin','imported');});console.log('Каталог импортирован.');}
 else {if(existsSync(file))throw new Error('Файл уже существует. Укажите новый путь.');writeFileSync(file,JSON.stringify({categories:catalog.categories(),products:catalog.products()},null,2)+'\n',{mode:0o600});console.log('Каталог экспортирован.');}
}finally{db.close();}
