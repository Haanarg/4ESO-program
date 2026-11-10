/* Execució Python interactiva compatible amb navegadors sense JSPI.
 * A cada resposta reexecutem de manera determinista el programa amb
 * l'historial d'entrades. El procés viu en un Worker d'iframe sandbox.
 */
(function(){
 const CDNS=[
  'https://cdn.jsdelivr.net/pyodide/v0.28.2/full/',
  'https://unpkg.com/pyodide@0.28.2/'
 ];
 // Dos proveïdors per a xarxes educatives on un CDN pot estar bloquejat.

 const MAX_INPUTS=250, MAX_OUTPUT=120000, MAX_CODE=30000;
 let engine=null, running=false, session=null;
 const emit=(type,detail={})=>self.postMessage({type,...detail});
 function pythonWrapper(code,inputs,seed){
  return [
   'import builtins, contextlib, io, random, traceback',
   '__run_out = io.StringIO()',
   '__run_inputs = iter('+JSON.stringify(inputs)+')',
   '__run_seed = '+seed,
   'random.seed(__run_seed)',
   'class __RunNeedsInput(BaseException):',
   ' def __init__(self,prompt): self.prompt=str(prompt)',
   'def __run_input(prompt=""):',
   ' try: value=next(__run_inputs)',
   ' except StopIteration: raise __RunNeedsInput(prompt)',
   ' print(str(prompt)+str(value))',
   ' return value',
   '__run_old_input=builtins.input',
   '__run_prompt=None',
   '__run_error=None',
   'builtins.input=__run_input',
   'try:',
   ' with contextlib.redirect_stdout(__run_out), contextlib.redirect_stderr(__run_out):',
   '  exec(compile('+JSON.stringify(code)+',"<alumne>","exec"),{"__name__":"__main__"})',
   'except __RunNeedsInput as request:',
   ' __run_prompt=request.prompt',
   'except BaseException:',
   ' __run_error=traceback.format_exc(limit=6)',
   'finally:',
   ' builtins.input=__run_old_input',
   '(__run_out.getvalue(),__run_prompt,__run_error)'
  ].join('\n');
 }
 async function replay(){
  if(!session||running)return;
  const current=session;
  running=true;
  try{
   let stage='execution';
   if(!engine){
    const provider=Number(current.cdnIndex)===1?1:0;
    const base=CDNS[provider];
    stage='loading';
    emit('loading',{stage,message:provider===0?'Descarregant Python (servidor principal)…':'Descarregant Python (servidor alternatiu)…'});
    importScripts(base+'pyodide.js');
    if(typeof loadPyodide!=='function')throw Error('El servidor no ha proporcionat el carregador de Python.');
    emit('loading',{stage,message:'Inicialitzant Python i WebAssembly…'});
    engine=await loadPyodide({indexURL:base});
    emit('engine_ready');
   }
   if(/\bmatplotlib\b/.test(current.code)){
    stage='package';
    emit('loading',{stage,message:'Carregant matplotlib…'});
    await engine.loadPackage('matplotlib');
   }
   stage='execution';
   emit('loading',{stage,message:'Executant el programa…'});
   let result=await engine.runPythonAsync(pythonWrapper(current.code,current.answers,current.seed));
   const output=String(result[0]??''),prompt=result[1],error=result[2];
   if(typeof result.destroy==='function')result.destroy();
   emit('replace',{text:output.slice(0,MAX_OUTPUT)+(output.length>MAX_OUTPUT?'\n… (sortida limitada)':'')});
   if(error){
    session=null;emit('error',{message:String(error).slice(0,2200)});
   }else if(prompt!==null&&prompt!==undefined){
    if(current.answers.length>=MAX_INPUTS){session=null;emit('error',{message:'S’ha arribat al límit de 250 respostes. Reinicia el programa.'});}
    else emit('input',{prompt:String(prompt).slice(0,500)});
   }else{session=null;emit('done');}
  }catch(error){
   session=null;emit('error',{stage:engine?'execution':'loading',message:String(error?.message||error||'No s’ha pogut iniciar Python.').slice(0,2200)});
  }finally{running=false;}
 }
 self.onmessage=e=>{
  const msg=e.data||{};
  if(msg.type==='start' && !running){
   const code=String(msg.code||'').slice(0,MAX_CODE);
   const inputs=msg.mode==='prepared'&&Array.isArray(msg.values)?msg.values.map(x=>String(x).slice(0,3000)).slice(0,MAX_INPUTS):[];
   session={code,answers:inputs,seed:Math.floor(Math.random()*2147483647),cdnIndex:Number(msg.cdnIndex)===1?1:0};
   replay();return;
  }
  if(msg.type==='answer' && !running && session && session.answers.length<MAX_INPUTS){
   session.answers.push(String(msg.value??'').slice(0,3000));
   replay();
  }
 };
})();