import 'dotenv/config';
import { REST,Routes } from 'discord.js';
import { commands } from './commands.js';
const discordToken=process.env.DISCORD_TOKEN?.trim()||process.env.BOT_TOKEN?.trim();
if(!discordToken)throw new Error('Заполните DISCORD_TOKEN или системную BOT_TOKEN.');
for(const k of ['APPLICATION_ID','GUILD_ID'])if(!process.env[k])throw new Error('Заполните '+k+' в .env');
await new REST({version:'10'}).setToken(discordToken).put(Routes.applicationGuildCommands(process.env.APPLICATION_ID!,process.env.GUILD_ID!),{body:commands});
console.log('Команды зарегистрированы на целевом сервере.');
