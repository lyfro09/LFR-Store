import { Store } from '../src/core/db.js';
import { loadConfig } from '../src/core/config.js';
import { Catalog } from '../src/modules/catalog.js';
import { Collection } from 'discord.js';
export function fixture(path=':memory:') {
 const db=new Store(path),c=loadConfig(),catalog=new Catalog(db);catalog.seed();
 // Generic order tests use a simple product; variant flows have separate tests.
 catalog.saveProduct({...catalog.product('nitro'),variantGroups:[],variants:[]});
 // Test optional contacts independently of the operator's local .env.
 c.DISCORD_URL='';c.TELEGRAM_URL='';c.PARTNERSHIP_CONTACT='';c.START_YEAR='';
 let next=100000000000000000n;
 for(const k of Object.keys(c.roles))db.bind('roles.'+k,String(next++));
 for(const spec of c.structure.categories)db.bind('categories.'+spec.key,String(next++));
 for(const spec of c.structure.channels)db.bind('channels.'+spec.key,String(next++));
 db.set('discounts',{[db.id('roles.golden')!]:3});
 c.tickets.cooldownSeconds=0;
 return {db,c,catalog};
}
export function remote(db:Store) {
 let sequence=200000000000000000n;const channels=new Map<string,any>();
 const client={user:{id:'999999999999999999'},options:{intents:{has:()=>true}}};
 const guild:any={id:'888888888888888888',client,channels:{fetch:async(id?:string)=>id?channels.get(id)??null:new Collection(channels)}};
 const add=(id:string)=>{
  const messages=new Map<string,any>();const channel:any={id,name:'канал',type:0,isTextBased:()=>true,isThread:()=>false,editCalls:[],sendCalls:[],deleted:false,permissionOverwrites:{set:async()=>{}},
   setName:async(name:string)=>{channel.name=name;channel.renamed=(channel.renamed??0)+1;},
   edit:async(data:any)=>{channel.editCalls.push(data);return channel;},delete:async()=>{channel.deleted=true;channels.delete(id);},
   messages:{fetch:async(arg:any)=>{if(typeof arg==='string'){const m=messages.get(arg);if(!m)throw Object.assign(new Error('Unknown message'),{code:10008});return m;}return new Collection([...messages].reverse().filter(([key])=>!arg.before||BigInt(key)<BigInt(arg.before)).slice(0,arg.limit));},delete:async(mid:string)=>{messages.delete(mid);}},
   send:async(data:any)=>{channel.sendCalls.push(data);const mid=String(sequence++);const m:any={id:mid,url:`https://discord.com/channels/${guild.id}/${id}/${mid}`,author:client.user,components:data.components??[],pinned:false,edits:[],pin:async()=>{m.pinned=true;},edit:async(d:any)=>{m.edits.push(d);m.components=d.components;return m;}};messages.set(mid,m);return m;},_messages:messages};channels.set(id,channel);return channel;
 };
 for(const r of db.all('SELECT id FROM resources WHERE key LIKE \'channels.%\''))add(r.id);
 return {guild,channels,add};
}
