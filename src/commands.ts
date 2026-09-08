import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } from 'discord.js';
const cmd=(name:string,description:string)=>new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild).setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
export const commands=[
 cmd('support','Открыть приватный тикет поддержки'),
 cmd('myorders','Мои заказы').addIntegerOption(o=>o.setName('page').setDescription('Страница').setMinValue(1)),
 cmd('panel','Управление панелями магазина').addStringOption(o=>o.setName('name').setDescription('Ключ панели или all').setRequired(true)),
 cmd('category','Открыть визуальную настройку категории').addStringOption(o=>o.setName('id').setDescription('ID категории, например discord').setRequired(true)),
 cmd('product','Открыть визуальную настройку товара').addStringOption(o=>o.setName('id').setDescription('ID товара, например nitro').setRequired(true)),
 cmd('discount','Настроить скидку для роли').addRoleOption(o=>o.setName('role').setDescription('Роль').setRequired(true)).addIntegerOption(o=>o.setName('percent').setDescription('Процент; 0 отключает скидку').setMinValue(0).setMaxValue(100).setRequired(true)),
 cmd('order','Просмотреть заказы магазина').addIntegerOption(o=>o.setName('page').setDescription('Страница').setMinValue(1)),
 cmd('ticket','Управление тикетом').addIntegerOption(o=>o.setName('id').setDescription('Номер тикета').setMinValue(1).setRequired(true)).addStringOption(o=>o.setName('action').setDescription('Действие').setRequired(true).addChoices(...[['claim','Принять'],['close','Закрыть'],['reopen','Открыть снова'],['delete','Удалить'],['archive','Архив'],['add','Добавить участника'],['remove','Убрать участника']].map(([value,name])=>({name,value})))).addUserOption(o=>o.setName('user').setDescription('Участник для add/remove')),
 cmd('giveaway','Посмотреть заявки на участие').addIntegerOption(o=>o.setName('page').setDescription('Страница').setMinValue(1)),
 cmd('rank','Назначить покупательский ранг').addUserOption(o=>o.setName('user').setDescription('Покупатель').setRequired(true)).addStringOption(o=>o.setName('rank').setDescription('Ранг').setRequired(true).addChoices({name:'Bronze',value:'bronze'},{name:'Golden',value:'golden'},{name:'Diamond',value:'diamond'})),
 cmd('review','Модерация или импорт отзыва').addIntegerOption(o=>o.setName('order').setDescription('Номер выполненного заказа').setMinValue(1).setRequired(true)).addStringOption(o=>o.setName('action').setDescription('Действие').setRequired(true).addChoices({name:'Удалить с причиной',value:'remove'},{name:'Импорт сообщения',value:'import'})).addStringOption(o=>o.setName('message').setDescription('ID существующего сообщения для импорта')),
 cmd('diagnostics','Проверить состояние магазина без секретов')
].map(x=>x.toJSON());
