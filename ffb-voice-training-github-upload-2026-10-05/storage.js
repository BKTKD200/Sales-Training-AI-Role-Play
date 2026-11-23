import path from 'node:path';
import crypto from 'node:crypto';
import {mkdir, readdir, readFile, writeFile, rename} from 'node:fs/promises';

export async function createStorage(env, root) {
  if (env.STORAGE_MODE !== 'mysql') return createFileStorage(root);
  for (const key of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']) if (!env[key]) throw new Error(`Missing ${key} for database storage.`);
  const {default:mysql} = await import('mysql2/promise');
  const db = mysql.createPool({host:env.DB_HOST,port:Number(env.DB_PORT || 3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectionLimit:5,charset:'utf8mb4',connectTimeout:10000});
  await db.query(`CREATE TABLE IF NOT EXISTS ffb_users (
    id CHAR(36) PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL,
    center VARCHAR(100) NULL, employee_name VARCHAR(100) NULL, allowed_centers TEXT NULL,
    active TINYINT NOT NULL DEFAULT 1, must_change_password TINYINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY employee_identity (center, employee_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS ffb_records (
    id VARCHAR(255) PRIMARY KEY, record_type VARCHAR(20) NOT NULL,
    user_id CHAR(36) NULL, center VARCHAR(100) NOT NULL, employee_name VARCHAR(100) NOT NULL,
    payload LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX owner_records (user_id), INDEX trainer_records (center, employee_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS ffb_logins (
    token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
    expires_at BIGINT NOT NULL, INDEX expiry (expires_at), INDEX login_user (user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const publicColumns='id,username,role,center,employee_name AS employeeName,allowed_centers AS allowedCenters,active,must_change_password AS mustChangePassword';
  const decodeUser=user=>user?{...user,allowedCenters:JSON.parse(user.allowedCenters||'[]')}:undefined;
  const query=async(sql,values=[])=> (await db.execute(sql,values))[0];
  return {
    mode:'mysql',
    async listRecords(type,user,{summary=false,ids}={}) {
      const payload=summary ? "CASE WHEN JSON_EXTRACT(payload,'$.dashboardSummary') IS NOT NULL THEN JSON_REMOVE(payload,'$.transcript','$.transcriptText','$.report') ELSE JSON_REMOVE(payload,'$.transcript','$.transcriptText') END AS payload" : 'payload';
      let sql=`SELECT id,${payload} FROM ffb_records WHERE record_type=?`;const args=[type];
      if(user?.role==='trainer'){sql+=' AND (user_id=? OR (user_id IS NULL AND center=? AND employee_name=?))';args.push(user.id,user.center,user.employeeName);}
      if(user?.role==='manager'){const allowed=user.allowedCenters||[];if(!allowed.length)return [];sql+=` AND center IN (${allowed.map(()=>'?').join(',')})`;args.push(...allowed);}
      if(ids){if(!ids.length)return [];sql+=` AND id IN (${ids.map(()=>'?').join(',')})`;args.push(...ids);}
      return (await query(sql,args)).map(row=>({...JSON.parse(row.payload),filename:row.id}));
    },
    async saveRecord(type,id,record,userId=null) {
      const owners=await query('SELECT id FROM ffb_users WHERE center=? AND employee_name=? LIMIT 1',[record.setup.center,record.setup.employeeName]);
      const ownerId=owners[0]?.id||null;
      await query('INSERT INTO ffb_records (id,record_type,user_id,center,employee_name,payload) VALUES (?,?,?,?,?,?)',[id,type,ownerId,record.setup.center,record.setup.employeeName,JSON.stringify({...record,recordedBy:userId})]);
      return {filename:id};
    },
    async updateRecord(type,id,record,user) {
      let sql='UPDATE ffb_records SET payload=? WHERE record_type=? AND id=?';
      const args=[JSON.stringify(record),type,id];
      if(user?.role==='trainer'){sql+=' AND (user_id=? OR (user_id IS NULL AND center=? AND employee_name=?))';args.push(user.id,user.center,user.employeeName);}
      if(user?.role==='manager'){const allowed=user.allowedCenters||[];if(!allowed.length)throw new Error('Record access denied.');sql+=` AND center IN (${allowed.map(()=>'?').join(',')})`;args.push(...allowed);}
      const result=await query(sql,args);
      if(!result.affectedRows)throw new Error('Record update failed.');
      return {filename:id};
    },
    async importRecords(records) {
      const conn=await db.getConnection();let added=0,existing=0;
      try {await conn.beginTransaction();
        for(const {id,type,record} of records) {
          const [rows]=await conn.execute('SELECT payload,record_type FROM ffb_records WHERE id=? FOR UPDATE',[id]);
          if(rows.length){
            if(rows[0].record_type!==type || JSON.stringify(JSON.parse(rows[0].payload))!==JSON.stringify(record)) throw new Error('Import conflicts with an existing record. No records were imported.');
            existing++;continue;
          }
          await conn.execute('INSERT INTO ffb_records (id,record_type,user_id,center,employee_name,payload) VALUES (?,?,NULL,?,?,?)',[id,type,record.setup.center,record.setup.employeeName,JSON.stringify(record)]);added++;
        }
        await conn.commit();return {added,existing};
      }catch(error){await conn.rollback();throw error;}finally{conn.release();}
    },
    async users(){return (await query(`SELECT ${publicColumns} FROM ffb_users ORDER BY username`)).map(decodeUser);},
    async userByUsername(username){return decodeUser((await query(`SELECT ${publicColumns},password_hash AS passwordHash FROM ffb_users WHERE LOWER(username)=?`,[String(username).toLowerCase()]))[0]);},
    async renameUser(id,username){await query('UPDATE ffb_users SET username=? WHERE id=?',[username,id]);},
    async addUser(user){await query('INSERT INTO ffb_users (id,username,password_hash,role,center,employee_name,allowed_centers,must_change_password) VALUES (?,?,?,?,?,?,?,?)',[user.id,user.username,user.passwordHash,user.role,user.center||null,user.employeeName||null,JSON.stringify(user.allowedCenters||[]),user.mustChangePassword?1:0]);},
    async bootstrap(user){
      const conn=await db.getConnection();
      try{
        const [lock]=await conn.execute("SELECT GET_LOCK(CONCAT('ffb-bootstrap-',DATABASE()),10) AS acquired");
        if(lock[0].acquired!==1)throw new Error('Could not initialize administrator.');
        const [rows]=await conn.execute("SELECT id FROM ffb_users WHERE role='admin' LIMIT 1");
        if(!rows.length){if(!user)throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD for the first administrator.');await conn.execute('INSERT INTO ffb_users (id,username,password_hash,role,must_change_password) VALUES (?,?,?,\'admin\',1)',[user.id,user.username,user.passwordHash]);}
      }finally{await conn.execute("SELECT RELEASE_LOCK(CONCAT('ffb-bootstrap-',DATABASE()))");conn.release();}
    },
    async setPassword(id,hash,mustChange){await query('UPDATE ffb_users SET password_hash=?,must_change_password=? WHERE id=?',[hash,mustChange?1:0,id]);await query('DELETE FROM ffb_logins WHERE user_id=?',[id]);},
    async deactivate(id){await query("UPDATE ffb_users SET active=0 WHERE id=? AND role IN ('trainer','manager')",[id]);await query('DELETE FROM ffb_logins WHERE user_id=?',[id]);},
    async createLogin(hash,id,expires){await query('INSERT INTO ffb_logins (token_hash,user_id,expires_at) VALUES (?,?,?)',[hash,id,expires]);await query('DELETE FROM ffb_logins WHERE expires_at<?',[Date.now()]);},
    async loginUser(hash){return decodeUser((await query(`SELECT ${publicColumns.split(',').map(column=>'u.'+column).join(',')} FROM ffb_logins l JOIN ffb_users u ON u.id=l.user_id WHERE l.token_hash=? AND l.expires_at>? AND u.active=1`,[hash,Date.now()]))[0]);},
    async deleteLogin(hash){await query('DELETE FROM ffb_logins WHERE token_hash=?',[hash]);},
    async close(){await db.end();},
  };
}

export function recordFilename(type,record) {
  const slug=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'practice';
  return `${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}-${slug(record.setup.employeeName)}-${slug(type==='skill'?record.setup.focusSkill:record.setup.difficulty)}.json`;
}

function createFileStorage(root) {
  const dir=type=>path.join(root,type==='skill'?'skill-practices':'sessions');
  return {mode:'files',
    async listRecords(type){
      let files;try{files=await readdir(dir(type));}catch(error){if(error.code==='ENOENT')return [];throw error;}
      const records=[];
      for(const filename of files.filter(name=>name.endsWith('.json'))){
        try{records.push({...JSON.parse(await readFile(path.join(dir(type),filename),'utf8')),filename});}
        catch{console.warn('An unreadable training file was skipped.');}
      }return records;
    },
    async saveRecord(type,id,record){await mkdir(dir(type),{recursive:true});const target=path.join(dir(type),id);await writeFile(target+'.tmp',JSON.stringify(record,null,2));await rename(target+'.tmp',target);return {filename:id};},
    async updateRecord(type,id,record){if(path.basename(id)!==id)throw new Error('Invalid record.');await readFile(path.join(dir(type),id));return this.saveRecord(type,id,record);},
    async close(){},
  };
}
