import 'dotenv/config';
import { REST,Routes } from 'discord.js';
import { commands } from './commands.js';
for(const k of ['DISCORD_TOKEN','APPLICATION_ID','GUILD_ID'])if(!process.env[k])throw new Error('Заполните '+k+' в .env');
await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN!).put(Routes.applicationGuildCommands(process.env.APPLICATION_ID!,process.env.GUILD_ID!),{body:commands});
console.log('Команды зарегистрированы на целевом сервере.');
