import crypto from 'node:crypto';
import {hashPassword,normalizeUsername,readBody,json} from './accountAuth.js';
import {initialAccounts} from './config/accountRoster.js';
export async function handleAdmin(req,res,url,store,employeesByCenter) {
  if(!url.pathname.startsWith('/api/admin/'))return false;
  if(!['admin','manager'].includes(req.user?.role)||store.mode!=='mysql'){json(res,403,{error:'Administrator account required.'});return true;}
  const manager=req.user.role==='manager';
  const canManage=user=>!manager||(user.role==='trainer'&&req.user.allowedCenters.includes(user.center));
  const permittedRoster=manager?Object.fromEntries(Object.entries(employeesByCenter).filter(([center])=>req.user.allowedCenters.includes(center))):employeesByCenter;
  try{
    if(url.pathname==='/api/admin/provision-roster'&&req.method==='POST'){
      if(manager){json(res,403,{error:'Full administrator access required.'});return true;}
      const credentials=[];const skipped=[];const failed=[];const renamed=[];
      for(const {legacyUsername,...entry} of initialAccounts){
        if(await store.userByUsername(entry.username)){skipped.push(entry.username);continue;}
        const legacy=legacyUsername?await store.userByUsername(legacyUsername):null;
        if(legacy){
          if(legacy.role!==entry.role||(legacy.center||null)!==(entry.center||null)||(legacy.employeeName||null)!==(entry.employeeName||null)){failed.push(entry.username);continue;}
          try{await store.renameUser(legacy.id,entry.username);renamed.push({from:legacyUsername,to:entry.username});}catch{failed.push(entry.username);}
          continue;
        }
        const password=crypto.randomBytes(18).toString('base64url');
        try{await store.addUser({...entry,id:crypto.randomUUID(),passwordHash:await hashPassword(password),mustChangePassword:true});credentials.push({...entry,password});}
        catch{failed.push(entry.username);}
      }
      json(res,200,{credentials,skipped,failed,renamed});return true;
    }
    if(url.pathname==='/api/admin/users'&&req.method==='GET'){json(res,200,{users:(await store.users()).filter(canManage),employeesByCenter:permittedRoster,role:req.user.role});return true;}
    if(url.pathname==='/api/admin/users'&&req.method==='POST'){
      const body=await readBody(req,8192);const role=['admin','manager','trainer'].includes(body.role)?body.role:'trainer';
      if(manager&&(role!=='trainer'||!req.user.allowedCenters.includes(body.center)))throw new Error('Select a trainer in one of your managed centers.');
      if(role!=='admin'&&!employeesByCenter[body.center]?.includes(body.employeeName))throw new Error('Select a configured center and employee.');
      const allowedCenters=role==='manager'?[...new Set(body.allowedCenters||[])]:[];
      if(role==='manager'&&(!allowedCenters.length||allowedCenters.some(center=>!employeesByCenter[center])||!allowedCenters.includes(body.center)))throw new Error('Select managed centers including the manager’s own center.');
      const user={id:crypto.randomUUID(),username:normalizeUsername(body.username),passwordHash:await hashPassword(body.password),role,center:role!=='admin'?body.center:null,employeeName:role!=='admin'?body.employeeName:null,allowedCenters,mustChangePassword:true};
      try{await store.addUser(user);}catch(error){if(error.code==='ER_DUP_ENTRY')throw new Error('That username or employee already has an account.');throw error;}
      json(res,201,{ok:true});return true;
    }
    if(url.pathname==='/api/admin/reset-password'&&req.method==='POST'){
      const body=await readBody(req,8192);if(!(await store.users()).some(user=>user.id===body.id&&canManage(user)))throw new Error('Account not found.');
      await store.setPassword(body.id,await hashPassword(body.password),true);json(res,200,{ok:true});return true;
    }
    if(url.pathname==='/api/admin/deactivate'&&req.method==='POST'){
      const body=await readBody(req,8192);if(!(await store.users()).some(user=>user.id===body.id&&['trainer','manager'].includes(user.role)&&canManage(user)))throw new Error('Only permitted trainer or manager accounts can be disabled here.');
      await store.deactivate(body.id);json(res,200,{ok:true});return true;
    }
    if(url.pathname==='/api/admin/export'&&req.method==='GET'){
      const records=[];for(const type of ['call','skill'])for(const item of await store.listRecords(type,req.user)){const {filename,...record}=item;records.push({id:filename,type,record});}
      res.setHeader('Content-Disposition','attachment; filename="ffb-training-backup.json"');json(res,200,{version:1,exportedAt:new Date().toISOString(),records});return true;
    }
    if(url.pathname==='/api/admin/import'&&req.method==='POST'){
      const body=await readBody(req,8*1024*1024);const records=validateImport(body.records);
      if(manager&&records.some(item=>!req.user.allowedCenters.includes(item.record.setup.center)))throw new Error('Import contains records outside your managed centers.');
      json(res,200,await store.importRecords(records));return true;
    }
    json(res,404,{error:'Unknown administrator operation.'});
  }catch(error){
    const known=['Use a ','Select a ','That username','Account not','Only trainer','Import ','Request too','Invalid request','Choose '].some(prefix=>error.message.startsWith(prefix));
    json(res,400,{error:known?error.message:'The operation could not be completed. Check the database connection and try again.'});
  }return true;
}

export function validateImport(items){
  if(!Array.isArray(items)||!items.length||items.length>500)throw new Error('Import 1–500 records per batch.');
  const ids=new Set();return items.map(item=>{
    if(!item||!['call','skill'].includes(item.type)||typeof item.id!=='string'||!/^[-a-zA-Z0-9._]{1,250}\.json$/.test(item.id)||ids.has(item.id))throw new Error('Import contains an invalid or duplicate record identifier.');
    ids.add(item.id);const record=item.record;
    if(!record||typeof record.setup?.center!=='string'||!record.setup.center.trim()||record.setup.center.length>100||typeof record.setup.employeeName!=='string'||!record.setup.employeeName.trim()||record.setup.employeeName.length>100||!Array.isArray(record.transcript)||!record.savedAt||Number.isNaN(Date.parse(record.savedAt)))throw new Error('Import contains an incomplete record. Keep the original JSON files.');
    if(item.type==='call'&&typeof record.report!=='string')throw new Error('Import call is missing its coaching report.');
    if(item.type==='skill'&&(!record.setup.focusSkill||record.recordType!=='skill-practice'))throw new Error('Import skill drill is missing its type or focus skill.');
    return {id:item.id,type:item.type,record};
  });
}
