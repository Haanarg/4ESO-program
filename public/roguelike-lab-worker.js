/* 12.5: Worker aïllat. Només rep codi de l'iframe sense same-origin.
 * Una execució amb bucle infinit es talla terminant el Worker sencer.
 */
(function(){
 const CDNS=['https://cdn.jsdelivr.net/pyodide/v0.28.2/full/','https://unpkg.com/pyodide@0.28.2/'];
 const MOVEMENT=['amunt','avall','esquerra','dreta'];
 const RESERVED=new Set(['w','a','s','d']);
 let engine=null,started=false,busy=false,allowedActions=new Set(MOVEMENT);
 // Acceptem només les accions anunciades al diccionari controls que retorna Python.
 // Els noms d'acció són valors, no fragments de codi: sempre es passen amb JSON.stringify.
 function updateAllowed(state){
  const allowed=new Set(MOVEMENT),data=state?.controls;
  if(data&&typeof data==='object'&&!Array.isArray(data)){
   let count=0;
   for(const [key,value] of Object.entries(data)){
    const k=key.trim().toLowerCase();
    if(!/^(?:[a-z0-9]|espai|enter)$/.test(k)||RESERVED.has(k)||++count>12)continue;
    const action=typeof value==='string'?value:value?.accio;
    if(typeof action==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(action))allowed.add(action);
   }
  }
  allowedActions=allowed;
  return state;
 }
 const send=(type,data={})=>self.postMessage({type,...data});
 async function load(code,provider){
  const base=CDNS[provider===1?1:0];
  send('loading',{message:'Carregant Python…'});
  importScripts(base+'pyodide.js');
  if(typeof loadPyodide!=='function')throw Error('No s’ha pogut descarregar Pyodide.');
  send('loading',{message:'Inicialitzant Python i WebAssembly…'});
  engine=await loadPyodide({indexURL:base});
  send('loading',{message:'Comprovant i executant el codi del videojoc…'});
  await engine.runPythonAsync(code);
  // Requereix que el programa implementi totes dues funcions.
  if(engine.runPython("callable(globals().get('inicia')) and callable(globals().get('torn'))")!==true)
   throw Error('El programa ha de definir inicia() i torn(direccio).');
 }
 function result(expression){
  const value=engine.runPython("import json\njson.dumps("+expression+", ensure_ascii=False, allow_nan=False)");
  const s=String(value);
  if(s.length>60000)throw Error('El mapa és massa gran per dibuixar-lo.');
  return updateAllowed(JSON.parse(s));
 }
 self.onmessage=async event=>{
  const msg=event.data||{};
  if(busy)return;
  if(msg.type==='start'&&!started){
   started=true;busy=true;
   try{
    const code=String(msg.code||'');
    if(code.length>30000)throw Error('El codi supera el límit de 30.000 caràcters.');
    await load(code,msg.cdnIndex===1?1:0);
    send('state',{state:result('inicia()')});
   }catch(error){
    send('error',{stage:engine?'code':'loading',message:String(error?.message||error).slice(0,1400)});
   }finally{busy=false;}
  }else if((msg.type==='move'||msg.type==='action')&&started&&engine){
   const action=msg.type==='move'?msg.direction:msg.action;
   if(typeof action!=='string'||!allowedActions.has(action))return;
   busy=true;
   try{send('state',{state:result('torn('+JSON.stringify(action)+')')});}
   catch(error){send('error',{stage:'turn',message:String(error?.message||error).slice(0,1400)});}
   finally{busy=false;}
  }else if(msg.type==='new'&&started&&engine){
   busy=true;
   try{send('state',{state:result('inicia()')});}
   catch(error){send('error',{stage:'turn',message:String(error?.message||error).slice(0,1400)});}
   finally{busy=false;}
  }
 };
})();
