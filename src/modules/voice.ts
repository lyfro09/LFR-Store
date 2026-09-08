import { ChannelType, type Guild } from 'discord.js';
import { entersState, joinVoiceChannel, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';

export class VoiceKeeper {
 private guild?:Guild;
 private channelId='';
 private connection?:VoiceConnection;
 private timer?:NodeJS.Timeout;
 private retry?:NodeJS.Timeout;
 private pending?:Promise<void>;
 private lastError='';
 private lastErrorAt=0;
 constructor(private readonly report:(error:unknown)=>void) {}
 start(guild:Guild,channelId:string) {this.guild=guild;this.channelId=channelId;void this.ensure();this.timer=setInterval(()=>void this.ensure(),30_000);}
 reconnect() {void this.ensure(true);}
 private joined() {return this.guild?.members.me?.voice.channelId===this.channelId;}
 private schedule(delay=5_000) {if(this.retry)return;this.retry=setTimeout(()=>{this.retry=undefined;void this.ensure();},delay);}
 private async ensure(force=false) {
  if(this.pending)return this.pending;
  this.pending=this.connect(force).catch(error=>{const reported=error instanceof Error&&error.name==='AbortError'?new Error(`Голосовое подключение не готово за 30 секунд (состояние: ${this.connection?.state.status??'не создано'}). Хостинг должен разрешать исходящий и входящий UDP-трафик.`):error,message=reported instanceof Error?reported.message:String(reported),now=Date.now();if(message!==this.lastError||now-this.lastErrorAt>10*60_000){this.lastError=message;this.lastErrorAt=now;this.report(reported);}if(!this.joined())this.schedule(15_000);}).finally(()=>{this.pending=undefined;});return this.pending;
 }
 private async connect(force:boolean) {
  if(!this.guild||!this.channelId)return;
  if(!force&&this.connection?.joinConfig.channelId===this.channelId&&this.connection.state.status!==VoiceConnectionStatus.Destroyed&&(this.connection.state.status===VoiceConnectionStatus.Ready||this.joined()))return;
  const previous=this.connection;this.connection=undefined;if(previous&&previous.state.status!==VoiceConnectionStatus.Destroyed)previous.destroy();
  const channel=await this.guild.channels.fetch(this.channelId);
  if(!channel||channel.guildId!==this.guild.id||![ChannelType.GuildVoice,ChannelType.GuildStageVoice].includes(channel.type as ChannelType))throw new Error(`VOICE_CHANNEL_ID ${this.channelId} не является голосовым каналом этого сервера.`);
  const connection=joinVoiceChannel({guildId:this.guild.id,channelId:this.channelId,adapterCreator:this.guild.voiceAdapterCreator,selfDeaf:true,selfMute:true});this.connection=connection;
  connection.on('error',error=>this.report(error));connection.on('stateChange',(_,next)=>{if(this.connection===connection&&(next.status===VoiceConnectionStatus.Disconnected||next.status===VoiceConnectionStatus.Destroyed))this.schedule();});
  try{await entersState(connection,VoiceConnectionStatus.Ready,30_000);}catch(error){if(!(error instanceof Error&&error.name==='AbortError'&&this.joined()))throw error;console.warn(`Голосовой транспорт не достиг Ready, но бот остаётся в канале ${this.channelId}.`);}
  this.lastError='';this.lastErrorAt=0;console.log(`Голосовой канал подключён: ${this.channelId}.`);
 }
 stop() {if(this.timer)clearInterval(this.timer);if(this.retry)clearTimeout(this.retry);if(this.connection&&this.connection.state.status!==VoiceConnectionStatus.Destroyed)this.connection.destroy();}
}
