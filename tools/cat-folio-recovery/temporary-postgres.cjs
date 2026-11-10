'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');const {randomUUID}=require('node:crypto');
const bin='C:/Program Files/PostgreSQL/18/bin',owned=new Set();let serial=0;
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});

function execute(name,args,options={}) {
  const {acceptExitCodes=[0],...spawnOptions}=options;
  let fd,log;
  if(name==='pg_ctl'){
    const at=args.indexOf('-D');assert.ok(at>=0&&args[at+1],'pg_ctl requires an explicit directory');
    log=path.join(path.dirname(args[at+1]),`pg_ctl-${Date.now()}-${process.pid}-${++serial}.log`);
    fd=fs.openSync(log,'wx');
  }
  const started=Date.now();let result;
  try {
    // A Windows pg_ctl/cmd/postgres grandchild retains pipe handles even with -l.
    // Regular files close the caller independently of the server's lifetime.
    result=spawnSync(path.join(bin,`${name}.exe`),args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024,
      ...spawnOptions,stdio:fd===undefined?['ignore','pipe','pipe']:['ignore',fd,fd]});
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  const text=log?fs.readFileSync(log,'utf8'):(result.stdout||'');
  if(log)write(`${log}.json`,{command:name,args,status:result.status,error:result.error?.code||null,signal:result.signal,elapsedMs:Date.now()-started});
  // status=0 DOES NOT mean success when spawnSync reports ETIMEDOUT (observed on Windows).
  if(result.error||result.signal||!acceptExitCodes.includes(result.status)){
    const error=new Error(`${name} failed: exit=${result.status}, error=${result.error?.code||'none'}, signal=${result.signal||'none'}`);
    error.code=result.error?.code||'NATIVE_COMMAND_FAILED';
    Object.assign(error,{command:name,args,status:result.status,signal:result.signal,stderr:result.stderr||'',stdout:text});throw error;
  }
  return {stdout:text,status:result.status};
}
const native=(name,args,options)=>execute(name,args,options).stdout;

function validateRoot(root) {
  assert.equal(path.dirname(root).toLowerCase(),path.resolve(os.tmpdir(),'opencode').toLowerCase(),'Not an approved temporary root');
  assert.ok(/^cat-recovery-(phase[23]-|test-restore-|lifecycle-)/.test(path.basename(root)),'Not a recovery sandbox');
  assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
  assert.ok(same(fs.realpathSync(root),root),'Root is a reparse point');
}
function validate(spec) {
  validateRoot(spec.root);
  assert.ok(same(spec.data,path.join(spec.root,'pgdata')));assert.ok(Number.isInteger(spec.port)&&spec.port>=55441&&spec.port<=55449);
  assert.equal(spec.host,'127.0.0.1');
  const stored=read(path.join(spec.root,'lifecycle.json'));assert.equal(stored.nonce,spec.nonce);
  assert.equal(stored.ownerPid,spec.ownerPid);assert.ok(same(stored.data,spec.data));assert.equal(stored.port,spec.port);
  if(fs.existsSync(spec.data)){assert.equal(fs.lstatSync(spec.data).isSymbolicLink(),false);assert.ok(same(fs.realpathSync(spec.data),spec.data),'Data directory redirected');}
}

function postmasterIdentity(spec) {
  const file=path.join(spec.data,'postmaster.pid');if(!fs.existsSync(file))return null;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/),pid=Number(lines[0]);
  assert.ok(Number.isInteger(pid)&&pid>0);assert.ok(same(lines[1],spec.data),'PID file points elsewhere');assert.equal(Number(lines[3]),spec.port);
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { [pscustomobject]@{name=$p.Name;command=$p.CommandLine;started=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress }`;
  const r=spawnSync(ps,['-NoProfile','-Command',script],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:5000});
  if(r.error||r.status!==0)throw new Error('Cannot verify owned postmaster; stop refused');
  if(!r.stdout.trim())return null;
  const identity=JSON.parse(r.stdout),match=/-D\s+(?:"([^"]+)"|(\S+))/i.exec(identity.command||'');
  assert.equal(identity.name.toLowerCase(),'postgres.exe','PID reused by a different process');
  assert.ok(match&&same(match[1]||match[2],spec.data),'Process command is not the owned data directory');
  assert.ok(Math.abs(Date.parse(identity.started)-Number(lines[2])*1000)<5000,'PID creation time mismatch');
  return {pid,started:identity.started};
}

function stopOwned(spec,reason) {
  validate(spec);const stopped=path.join(spec.root,'stopped.json');if(fs.existsSync(stopped)){assert.equal(read(stopped).nonce,spec.nonce);return read(stopped);}
  const identity=postmasterIdentity(spec);
  if(identity)execute('pg_ctl',['-D',spec.data,'-m','fast','-w','-t','30','stop'],{timeout:35000});
  if(fs.existsSync(path.join(spec.data,'PG_VERSION'))){
    const status=execute('pg_ctl',['-D',spec.data,'status'],{acceptExitCodes:[0,3],timeout:5000});
    assert.equal(status.status,3,'Owned PostgreSQL is still running');
  }
  const receipt={nonce:spec.nonce,root:spec.root,dataDirectory:spec.data,port:spec.port,postmasterPid:identity?.pid||null,
    reason,verifiedStopped:true,stoppedAt:new Date().toISOString()};
  try{write(stopped,receipt);}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(read(stopped).nonce,spec.nonce);return read(stopped);}return receipt;
}

class TemporaryPostgres {
  constructor(root,port,{maxLifetimeMs=180000}={}){
    root=path.resolve(root);validateRoot(root);assert.ok(Number.isInteger(port)&&port>=55441&&port<=55449);
    assert.ok(Number.isInteger(maxLifetimeMs)&&maxLifetimeMs>=1000&&maxLifetimeMs<=600000);
    assert.equal(fs.existsSync(path.join(root,'pgdata')),false,'Refuse claiming an existing cluster');
    this.spec={root,data:path.join(root,'pgdata'),port,host:'127.0.0.1',ownerPid:process.pid,nonce:randomUUID(),maxLifetimeMs};
    assert.equal(fs.existsSync(path.join(root,'lifecycle.json')),false,'Refuse reusing an owned cluster');
    write(path.join(root,'lifecycle.json'),this.spec);validate(this.spec);owned.add(this);
  }
  init(){assert.equal(fs.existsSync(this.spec.data),false,'Refuse existing PostgreSQL data');native('initdb',['-D',this.spec.data,'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'],{timeout:30000});}
  start(){
    validate(this.spec);const log=fs.openSync(path.join(this.spec.root,'watchdog.log'),'wx');
    try{this.watchdog=spawn(process.execPath,[__filename,'--watchdog',path.join(this.spec.root,'lifecycle.json')],{detached:true,windowsHide:true,stdio:['ignore',log,log]});
      this.watchdog.once('error',()=>{});this.watchdog.unref();}finally{fs.closeSync(log);}
    const ready=path.join(this.spec.root,'watchdog-ready.json'),until=Date.now()+5000;
    while(!fs.existsSync(ready)&&Date.now()<until)sleep(25);
    try{
      assert.ok(fs.existsSync(ready),'Watchdog did not start; no PostgreSQL will be launched');assert.equal(read(ready).nonce,this.spec.nonce);
      write(path.join(this.spec.root,'start-intent.json'),{deadline:Date.now()+12000});
      native('pg_ctl',['-D',this.spec.data,'-l',path.join(this.spec.root,'postgres.log'),'-o',`-p ${this.spec.port} -h 127.0.0.1`,'-w','-t','10','start'],{timeout:15000});
      const identity=postmasterIdentity(this.spec);assert.ok(identity,'Postmaster identity missing after start');return identity;
    }catch(error){try{this.stop('start-failed');}catch(cleanup){throw new AggregateError([error,cleanup],'Start and cleanup failed');}throw error;}
  }
  stop(reason='finally'){
    const result=stopOwned(this.spec,reason);owned.delete(this);
    if(this.watchdog){const done=path.join(this.spec.root,'watchdog-done.json'),until=Date.now()+3000;while(!fs.existsSync(done)&&Date.now()<until)sleep(25);assert.ok(fs.existsSync(done),'Watchdog has not acknowledged cleanup');}
    return result;
  }
}

function deadline(promise,ms,label) {
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);})]).finally(()=>clearTimeout(timer));
}
function cleanupAll(reason){for(const instance of [...owned])try{instance.stop(reason);}catch(e){console.error('TEMP_POSTGRES_CLEANUP_FAILED',e.message);process.exitCode=1;}}
process.once('exit',()=>cleanupAll('process-exit'));
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129],['SIGBREAK',149]])process.once(signal,()=>{cleanupAll(signal);process.exit(code);});

function watchdog(file) {
  const spec=read(file);validate(spec);write(path.join(spec.root,'watchdog-ready.json'),{nonce:spec.nonce,pid:process.pid});
  const ends=Date.now()+spec.maxLifetimeMs;
  const timer=setInterval(()=>{
    try{
      if(fs.existsSync(path.join(spec.root,'stopped.json'))){clearInterval(timer);write(path.join(spec.root,'watchdog-done.json'),{nonce:spec.nonce,reason:'owner-cleanup'});return;}
      let alive=true;try{process.kill(spec.ownerPid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive&&Date.now()<ends)return;
      const intent=path.join(spec.root,'start-intent.json');
      if(!fs.existsSync(path.join(spec.data,'postmaster.pid'))&&fs.existsSync(intent)&&Date.now()<read(intent).deadline)return;
      stopOwned(spec,alive?'watchdog-deadline':'watchdog-owner-exited');clearInterval(timer);
      write(path.join(spec.root,'watchdog-done.json'),{nonce:spec.nonce,reason:alive?'deadline':'owner-exited'});
    }catch(e){clearInterval(timer);write(path.join(spec.root,'watchdog-error.json'),{nonce:spec.nonce,error:e.message});process.exitCode=1;}
  },200);
}
module.exports={native,TemporaryPostgres,deadline};
if(require.main===module){assert.equal(process.argv[2],'--watchdog');watchdog(process.argv[3]);}
