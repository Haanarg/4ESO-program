/* Prototip de masmorra. Només executa el fitxer Python de confiança
 * public/roguelike-prototype.py, mai codi proporcionat per alumnes.
 * No requereix finestres ni permisos especials i no bloqueja la UI.
 */
(function(){
 const SOURCES=['https://cdn.jsdelivr.net/pyodide/v0.28.2/full/','https://unpkg.com/pyodide@0.28.2/'];
 let engine=null,ready=false,busy=false,started=false;
 const MOVEMENT=['amunt','avall','esquerra','dreta'];
 const RESERVED=new Set(['w','a','s','d']);
 let allowedActions=new Set(MOVEMENT);
 function validateActions(state){
  const allowed=new Set(MOVEMENT);
  const keys=state?.controls;
  if(keys&&typeof keys==='object'&&!Array.isArray(keys)){
   let count=0;
   for(const [key,item] of Object.entries(keys)){
    const k=key.trim().toLowerCase();
    if(!/^(?:[a-z0-9]|espai|enter)$/.test(k)||RESERVED.has(k))continue;
    const action=typeof item==='string'?item:item?.accio;
    if(typeof action==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(action)){allowed.add(action);if(++count>=12)break;}
   }
  }
  allowedActions=allowed;
  return state;
 }
 const send=(type,data={})=>self.postMessage({type,...data});
 async function load(index){
  const base=SOURCES[index===1?1:0];
  send('loading',{message:index===1?'Carregant Python des del servidor alternatiu…':'Carregant Python…'});
  importScripts(base+'pyodide.js');
  if(typeof loadPyodide!=='function')throw Error('El motor Python no s’ha pogut inicialitzar.');
  send('loading',{message:'Inicialitzant el motor de la masmorra…'});
  engine=await loadPyodide({indexURL:base});
  const response=await fetch('/roguelike-prototype.py',{cache:'no-store'});
  if(!response.ok)throw Error('No s’ha pogut carregar el codi Python del joc ('+response.status+').');
  const code=await response.text();
  if(code.length>20000)throw Error('El codi del joc és massa llarg.');
  await engine.runPythonAsync(code);
  ready=true;
  send('ready');
 }
 function validState(state){
  if(!state||typeof state!=='object')throw Error('L’estat del joc no és vàlid.');
  const map=state.mapa;
  if(!Array.isArray(map)||map.length<2||map.length>50||!map.every(row=>typeof row==='string'&&row.length===map[0].length&&row.length<=60)){
   throw Error('El mapa Python no té les dimensions correctes.');
  }
  if(!Array.isArray(state.jugador)||state.jugador.length!==2||!state.jugador.every(Number.isInteger))throw Error('Posició de jugador incorrecta.');
  return validateActions(state);
 }
 function play(functionCall){
  if(!ready)throw Error('Python encara no està preparat.');
  const result=engine.runPython('import json\njson.dumps('+functionCall+',ensure_ascii=False)');
  return validState(JSON.parse(String(result)));
 }
 self.onmessage=async ev=>{
  const msg=ev.data||{};
  if(busy)return;
  if(msg.type==='init'&&!started){
   started=true;busy=true;
   try{
    await load(msg.cdnIndex===1?1:0);
    send('state',{state:play('inicia()')});
   }catch(error){send('error',{stage:'loading',message:String(error?.message||error)});}
   finally{busy=false;}
   return;
  }
  if(msg.type==='new'&&ready){
   busy=true;
   try{send('state',{state:play('inicia()')});}
   catch(error){send('error',{stage:'turn',message:String(error?.message||error)});}
   finally{busy=false;}
   return;
  }
  if((msg.type==='move'||msg.type==='action')&&ready){
   const action=msg.type==='move'?msg.direction:msg.action;
   if(typeof action!=='string'||!allowedActions.has(action))return;
   busy=true;
   try{send('state',{state:play('torn('+JSON.stringify(action)+')')});}
   catch(error){send('error',{stage:'turn',message:String(error?.message||error)});}
   finally{busy=false;}
  }
 };
})();
