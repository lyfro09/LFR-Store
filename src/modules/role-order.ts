import { UserError, type Store } from '../core/db.js';
import { roleOrder } from '../core/auth.js';
export type PositionedRole={id:string;name:string;rawPosition:number;managed:boolean};
export function sortedRoles(roles:Iterable<PositionedRole>) {
 return [...roles].sort((a,b)=>a.rawPosition-b.rawPosition||(BigInt(a.id)>BigInt(b.id)?-1:BigInt(a.id)<BigInt(b.id)?1:0));
}
/** Normalize the complete order, like discord.js Role#setPosition.
 * Replace only the shop slots: the bot and every unrelated role retain their
 * relative places. rawPosition is not the number of roles below a role.
 */
export function planRolePositions(roles:Iterable<PositionedRole>,botRoleId:string,db:Store) {
 const current=sortedRoles(roles),botIndex=current.findIndex(r=>r.id===botRoleId);
 if(botIndex<0)throw new UserError('Не найдена высшая роль бота.');
 const wanted=roleOrder.map(key=>{
  const id=db.id('roles.'+key),index=current.findIndex(r=>r.id===id);
  if(index<0)throw new UserError('Не найдена созданная роль '+key);
  const role=current[index];
  if(index>=botIndex||role.managed)throw new UserError(`Роль «${role.name}» недоступна для управления. Роль бота должна находиться выше неё.`);
  return role;
 }).reverse();
 if(new Set(wanted.map(r=>r.id)).size!==wanted.length)throw new UserError('Несколько ролей магазина привязаны к одному ID.');
 const ids=new Set(wanted.map(r=>r.id));let next=0;
 const desired=current.map(r=>ids.has(r.id)?wanted[next++]:r);
 if(desired.every((r,index)=>r.id===current[index].id))return [];
 return desired.map((r,position)=>({role:r.id,position}));
}
export function verifyRoleOrder(roles:Iterable<PositionedRole>,botRoleId:string,db:Store) {
 if(planRolePositions(roles,botRoleId,db).length)throw new UserError('Discord не применил порядок ролей магазина. Повторите !shop-setup; сохранённые роли будут использованы повторно.');
}
