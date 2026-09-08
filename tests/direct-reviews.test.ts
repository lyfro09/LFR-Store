import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { fixture,remote } from './helpers.js';
import { Reviews } from '../src/modules/reviews.js';

test('Прямой отзыв учитывается только от покупательского ранга и снимается при удалении',async()=>{
 const {db}=fixture(),{guild}=remote(db),reviews=new Reviews(db),channelId=db.id('channels.reviews')!;process.env.GUILD_ID=guild.id;let reactions=0,deletions=0;
 const message=(id:string,roles:string[],content='Хороший магазин')=>({id,guildId:guild.id,channelId,guild,author:{id:'buyer',bot:false},webhookId:null,member:{roles:{cache:new Collection(roles.map(r=>[r,{}]))}},content,attachments:new Collection(),createdTimestamp:123,react:async()=>{reactions++;},delete:async()=>{deletions++;}} as any);
 await reviews.capture(message('review-1',[db.id('roles.bronze')!]));assert.equal(reviews.count(),1);assert.equal(reactions,1);
 await reviews.capture(message('review-1',[db.id('roles.bronze')!]));assert.equal(reviews.count(),1);
 await reviews.capture(message('review-2',[]));assert.equal(reviews.count(),1);assert.equal(deletions,1);
 reviews.removed('review-1');assert.equal(reviews.count(),0);db.close();
});
