import crypto from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(crypto.scrypt);
export function validatePassword(value){if(typeof value!=='string'||value.length<16||value.length>128)throw new Error('Use a password between 16 and 128 characters.');}
export async function hashPassword(password){validatePassword(password);const salt=crypto.randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64);return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password,encoded){if(typeof password!=='string'||password.length>128)return false;const [salt,hex]=String(encoded||'').split(':');if(!salt||!hex)return false;const expected=Buffer.from(hex,'hex');const actual=await scrypt(password,salt,64);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}
export async function readBody(req,max=1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('Request too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new Error('Invalid request.');}}
export const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const publicUser=user=>({id:user.id,username:user.username,role:user.role,center:user.center,employeeName:user.employeeName,allowedCenters:user.allowedCenters||[],mustChangePassword:Boolean(user.mustChangePassword)});

export async function createAccountGate({store,env}) {
  if(store.mode!=='mysql')throw new Error('Individual accounts require persistent MySQL storage.');
  const production=env.NODE_ENV==='production';
  if(production&&!env.APP_ORIGIN?.startsWith('https://'))throw new Error('Set APP_ORIGIN to the HTTPS website URL.');
  let admin;
  if(env.ADMIN_PASSWORD){admin={id:crypto.randomUUID(),username:normalizeUsername(env.ADMIN_USERNAME||'bryan'),passwordHash:await hashPassword(env.ADMIN_PASSWORD)};}
  await store.bootstrap(admin);
  const dummyHash=await hashPassword(crypto.randomBytes(24).toString('hex'));
  const failures=new Map();const lifetime=8*60*60*1000;
  const cookieName=production?'__Host-ffb_account':'ffb_account';
  const cookie=(value,seconds)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${production?'; Secure':''}`;
  const redirect=(res,target)=>{res.writeHead(303,{Location:target});res.end();};
  async function newLogin(res,user){const token=crypto.randomBytes(32).toString('hex');await store.createLogin(digest(token),user.id,Date.now()+lifetime);res.setHeader('Set-Cookie',cookie(token,lifetime/1000));}
  return async function gate(req,res,url){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    if(url.pathname==='/healthz'&&req.method==='GET'){json(res,200,{ok:true});return true;}
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==(env.APP_ORIGIN||`http://${req.headers.host}`)){json(res,403,{error:'Request origin is not allowed.'});return true;}
    const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    const user=token?await store.loginUser(digest(token)):null;
    req.user=user;
    if(url.pathname==='/api/login-mode'&&req.method==='GET'){json(res,200,{mode:'accounts'});return true;}
    if(url.pathname==='/login'&&req.method==='POST'){
      try{
        const body=await readBody(req,8192);const username=normalizeUsername(body.username);
        const now=Date.now();for(const [key,value] of failures)if(value.until<=now)failures.delete(key);
        const addressKey=digest(req.socket.remoteAddress||'unknown');const addressFailure=failures.get(addressKey);
        const key=digest((req.socket.remoteAddress||'unknown')+':'+username);const prior=failures.get(key);
        if(prior?.count>=10||addressFailure?.count>=50){json(res,429,{error:'Too many attempts. Try again in five minutes.'});return true;}
        const account=await store.userByUsername(username);
        const valid=await verifyPassword(body.password,account?.passwordHash||dummyHash);
        if(!account?.active||!valid){failures.set(key,{count:(prior?.count||0)+1,until:prior?.until||now+5*60*1000});failures.set(addressKey,{count:(addressFailure?.count||0)+1,until:addressFailure?.until||now+5*60*1000});json(res,401,{error:'Incorrect username or password.'});return true;}
        failures.delete(key);if(token)await store.deleteLogin(digest(token));await newLogin(res,account);json(res,200,{ok:true,mustChangePassword:Boolean(account.mustChangePassword)});
      }catch(error){json(res,400,{error:error.message==='Request too large.'?'Request too large.':'Could not sign in. Check your username and password.'});}
      return true;
    }
    if(url.pathname==='/logout'&&req.method==='POST'){if(token)await store.deleteLogin(digest(token));res.setHeader('Set-Cookie',cookie('',0));redirect(res,'/login');return true;}
    if(['/login','/login.html','/login.js','/styles.css','/brand-logo.png','/favicon.png'].includes(url.pathname)&&req.method==='GET'){
      if(user&&['/login','/login.html'].includes(url.pathname)){redirect(res,user.mustChangePassword?'/account':'/');return true;}return false;
    }
    if(!user){if(url.pathname.startsWith('/api/')||req.method!=='GET')json(res,401,{error:'Sign in to continue.'});else redirect(res,'/login');return true;}
    if(url.pathname==='/api/auth'&&req.method==='GET'){json(res,200,{enabled:true,mode:'accounts',user:publicUser(user),storage:'mysql'});return true;}
    if(url.pathname==='/api/account/password'&&req.method==='POST'){
      try{
        const body=await readBody(req,8192);const account=await store.userByUsername(user.username);
        if(!await verifyPassword(body.currentPassword,account.passwordHash)){json(res,400,{error:'Current password is incorrect.'});return true;}
        validatePassword(body.newPassword);if(body.currentPassword===body.newPassword)throw new Error('Choose a different password.');
        await store.setPassword(user.id,await hashPassword(body.newPassword),false);await newLogin(res,{...user,mustChangePassword:false});json(res,200,{ok:true});
      }catch(error){json(res,400,{error:error.message});}return true;
    }
    if(user.mustChangePassword&&!['/account','/account.html','/account.js','/styles.css','/brand-logo.png'].includes(url.pathname)){
      if(url.pathname.startsWith('/api/'))json(res,403,{error:'Change your temporary password before practicing.',code:'PASSWORD_CHANGE_REQUIRED'});else redirect(res,'/account');return true;
    }
    if((url.pathname.startsWith('/api/admin/')||['/admin','/admin.html','/admin.js'].includes(url.pathname))&&!['admin','manager'].includes(user.role)){json(res,403,{error:'Administrator access required.'});return true;}
    return false;
  };
}

export function normalizeUsername(value){const username=String(value||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(username))throw new Error('Use a username of 3–100 letters, numbers, or email characters.');return username;}
