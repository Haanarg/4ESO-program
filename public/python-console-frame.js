/* Pont amb iframe sandbox d'origen opac: cap accés a cookies ni DOM del curs. */
(function(){
 let child=null,session=null;
 const send=(type,data={})=>parent.postMessage({pythonConsole:true,id:session,type,...data},'*');
 window.addEventListener('message',event=>{
  if(event.source!==parent)return;
  const msg=event.data||{};
  if(msg.type==='start'){
   if(session)return;
   session=msg.id;
   try{
    const code="/* Execució Python interactiva compatible amb navegadors sense JSPI.\n * A cada resposta reexecutem de manera determinista el programa amb\n * l'historial d'entrades. El procés viu en un Worker d'iframe sandbox.\n */\n(function(){\n const CDN='https://cdn.jsdelivr.net/pyodide/v0.28.2/full/';\n const MAX_INPUTS=250, MAX_OUTPUT=120000, MAX_CODE=30000;\n let engine=null, running=false, session=null;\n const emit=(type,detail={})=>self.postMessage({type,...detail});\n function pythonWrapper(code,inputs,seed){\n  return [\n   'import builtins, contextlib, io, random, traceback',\n   '__run_out = io.StringIO()',\n   '__run_inputs = iter('+JSON.stringify(inputs)+')',\n   '__run_seed = '+seed,\n   'random.seed(__run_seed)',\n   'class __RunNeedsInput(BaseException):',\n   ' def __init__(self,prompt): self.prompt=str(prompt)',\n   'def __run_input(prompt=\"\"):',\n   ' try: value=next(__run_inputs)',\n   ' except StopIteration: raise __RunNeedsInput(prompt)',\n   ' print(str(prompt)+str(value))',\n   ' return value',\n   '__run_old_input=builtins.input',\n   '__run_prompt=None',\n   '__run_error=None',\n   'builtins.input=__run_input',\n   'try:',\n   ' with contextlib.redirect_stdout(__run_out), contextlib.redirect_stderr(__run_out):',\n   '  exec(compile('+JSON.stringify(code)+',\"<alumne>\",\"exec\"),{\"__name__\":\"__main__\"})',\n   'except __RunNeedsInput as request:',\n   ' __run_prompt=request.prompt',\n   'except BaseException:',\n   ' __run_error=traceback.format_exc(limit=6)',\n   'finally:',\n   ' builtins.input=__run_old_input',\n   '(__run_out.getvalue(),__run_prompt,__run_error)'\n  ].join('\\n');\n }\n async function replay(){\n  if(!session||running)return;\n  const current=session;\n  running=true;\n  try{\n   emit('loading',{message:engine?'Executant el programa…':'Carregant Python…'});\n   if(!engine){\n    importScripts(CDN+'pyodide.js');\n    engine=await loadPyodide({indexURL:CDN});\n   }\n   if(/\\bmatplotlib\\b/.test(current.code))await engine.loadPackage('matplotlib');\n   let result=await engine.runPythonAsync(pythonWrapper(current.code,current.answers,current.seed));\n   const output=String(result[0]??''),prompt=result[1],error=result[2];\n   if(typeof result.destroy==='function')result.destroy();\n   emit('replace',{text:output.slice(0,MAX_OUTPUT)+(output.length>MAX_OUTPUT?'\\n… (sortida limitada)':'')});\n   if(error){\n    session=null;emit('error',{message:String(error).slice(0,2200)});\n   }else if(prompt!==null&&prompt!==undefined){\n    if(current.answers.length>=MAX_INPUTS){session=null;emit('error',{message:'S’ha arribat al límit de 250 respostes. Reinicia el programa.'});}\n    else emit('input',{prompt:String(prompt).slice(0,500)});\n   }else{session=null;emit('done');}\n  }catch(error){\n   session=null;emit('error',{message:String(error?.message||error||'No s’ha pogut iniciar Python.').slice(0,2200)});\n  }finally{running=false;}\n }\n self.onmessage=e=>{\n  const msg=e.data||{};\n  if(msg.type==='start' && !running){\n   const code=String(msg.code||'').slice(0,MAX_CODE);\n   const inputs=msg.mode==='prepared'&&Array.isArray(msg.values)?msg.values.map(x=>String(x).slice(0,3000)).slice(0,MAX_INPUTS):[];\n   session={code,answers:inputs,seed:Math.floor(Math.random()*2147483647)};\n   replay();return;\n  }\n  if(msg.type==='answer' && !running && session && session.answers.length<MAX_INPUTS){\n   session.answers.push(String(msg.value??'').slice(0,3000));\n   replay();\n  }\n };\n})();";
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    try{child=new Worker(url)}catch(error){URL.revokeObjectURL(url);throw error}
    // Alguns navegadors carreguen el Worker de manera diferida.
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    child.onmessage=e=>{const result=e.data||{};send(result.type,result)};
    child.onerror=e=>{send('error',{message:'No s’ha pogut engegar l’executor Python: '+String(e.message||'Error del Worker')});e.preventDefault?.()};
    child.postMessage({type:'start',code:String(msg.code||'')});
   }catch(error){send('error',{message:'No es pot iniciar la consola aïllada: '+String(error.message||error)})}
  }else if(msg.id===session && child && (msg.type==='answer'||msg.type==='prepared')){
   child.postMessage(msg.type==='prepared'
     ? {type:'start',code:String(msg.code||''),mode:'prepared',values:msg.values}
     : {type:'answer',value:msg.value});
  }
 });
 send('ready');
})();
