import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from './config.js';
import type { Activity } from './activity.js';
export interface Identity { role:'teacher'|'student'; groupId?:string; memberId?:string }
declare global { namespace Express { interface Request { identity?:Identity; importGeneration?:number } } }
const reject=(res:Response,status:number,code:string,message:string)=>res.status(status).json({code,message});
export function authenticate(config:AppConfig,activity:Activity,requireActivity=true) {
  return (req:Request,res:Response,next:NextFunction)=>{
    res.setHeader('Cache-Control','no-store');
    const supplied=req.header('X-Activity-Id');
    if((requireActivity||supplied!==undefined)&&supplied!==activity.id) return reject(res,409,'ACTIVITY_EXPIRED','活動已重新啟動，請重新輸入教師密碼或有效加入碼。');
    const header=req.header('Authorization'); let decoded='';
    if(header?.startsWith('Basic ')&&/^[A-Za-z0-9+/]+={0,2}$/.test(header.slice(6))) decoded=Buffer.from(header.slice(6),'base64').toString('utf8');
    const separator=decoded.indexOf(':'), role=decoded.slice(0,separator), value=decoded.slice(separator+1);
    if(separator<0) return reject(res,401,'UNAUTHORIZED','請選擇身分並輸入教師密碼或加入碼。');
    if(role==='teacher'&&value===config.teacherPassword) {req.identity={role:'teacher'};return next();}
    if(role==='student') {
      const groupId=[...activity.joinCodes].find(([,code])=>code===value.trim())?.[0];
      if(!groupId||!activity.groups.some(g=>g.id===groupId)) return reject(res,401,'ACCESS_REVOKED','加入碼無效，請向老師確認。');
      const memberId=req.header('X-Member-Id');
      if(requireActivity&&(!memberId||activity.members.get(memberId)?.groupId!==groupId)) return reject(res,401,'UNAUTHORIZED','加入身分無效，請重新輸入加入碼與名稱。');
      req.identity={role:'student',groupId,...(memberId?{memberId}:{})}; return next();
    }
    return reject(res,401,'UNAUTHORIZED','教師密碼無效，請重新輸入。');
  };
}
export function requireTeacher(req:Request,res:Response,next:NextFunction) {
  if(req.identity?.role!=='teacher') return reject(res,403,'FORBIDDEN','此操作僅限教師使用，請以教師身分登入。'); next();
}
