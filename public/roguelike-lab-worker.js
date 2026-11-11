/* 12.5: Worker aïllat. Només rep codi de l'iframe sense same-origin.
 * Una execució amb bucle infinit es talla terminant el Worker sencer.
 */
(function(){
 const CDNS=['https://cdn.jsdelivr.net/pyodide/v0.28.2/full/','https://unpkg.com/pyodide@0.28.2/'];
 let engine=null,started=false,busy=false;
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
  return JSON.parse(s);
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
  }else if(msg.type==='move'&&started&&engine){
   if(!['amunt','avall','esquerra','dreta'].includes(msg.direction))return;
   busy=true;
   try{send('state',{state:result('torn('+JSON.stringify(msg.direction)+')')});}
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
