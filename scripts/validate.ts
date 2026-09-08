import { Store } from '../src/core/db.js';
import { loadConfig } from '../src/core/config.js';
import { Catalog } from '../src/modules/catalog.js';
import { Panels,buildPanel } from '../src/modules/panels.js';
const config=loadConfig(),db=new Store(':memory:');new Catalog(db).seed();let id=100000000000000000n;
for(const key of Object.keys(config.roles))db.bind('roles.'+key,String(id++));for(const c of config.structure.channels)db.bind('channels.'+c.key,String(id++));
for(const key of new Panels(db,()=>config).keys()){const p=buildPanel(key,config,db);console.log(`OK ${key}: ${p.files.length} баннер(ов)`);}
db.close();console.log('Конфигурация и панели валидны. Запросов Discord не выполнялось.');
