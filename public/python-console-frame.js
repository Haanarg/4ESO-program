// Pont mínim entre l'iframe sense origen i el Worker que executa Python.
(function(){
 let child=null, session=null, lastCode='';
 const send=(type,data={})=>parent.postMessage({pythonConsole:true,id:session,type,...data},'*');
 addEventListener('message',event=>{
   if(event.source!==parent)return;
   const msg=event.data||{};
   if(msg.type==='start'){
     if(session)return;
     session=msg.id;lastCode=String(msg.code||'');
     try{
       const url=URL.createObjectURL(new Blob(["/* Executor Python aïllat. Es carrega dins un Worker creat per un iframe sandbox. */\n(function(){\n const CDN='https://cdn.jsdelivr.net/pyodide/v0.28.2/full/';\n let engine=null, running=false, pending=null;\n const emit=(type,detail={})=>self.postMessage({type,...detail});\n self.__console_out=text=>emit('output',{text:String(text).slice(0,15000)});\n self.__console_input=prompt=>new Promise((resolve,reject)=>{\n   if(pending){reject(Error('Ja hi ha una entrada pendent.'));return;}\n   pending={resolve,reject};\n   emit('input',{prompt:String(prompt).slice(0,500)});\n });\n self.onmessage=async e=>{\n   const msg=e.data||{};\n   if(msg.type==='answer'&&pending){\n     const request=pending;pending=null;\n     request.resolve(String(msg.value??'').slice(0,3000));\n     return;\n   }\n   if(msg.type!=='start'||running)return;\n   running=true;\n   try{\n     emit('loading');\n     if(!engine){\n       importScripts(CDN+'pyodide.js');\n       engine=await loadPyodide({indexURL:CDN});\n     }\n     const source=String(msg.code||'').slice(0,30000);\n     const prepared=msg.mode==='prepared';\n     const values=Array.isArray(msg.values)?msg.values.map(x=>String(x).slice(0,3000)).slice(0,1000):[];\n     const script=`import builtins, sys, traceback\nfrom pyodide.ffi import run_sync, can_run_sync\nfrom js import __console_out, __console_input\nif ${!prepared?'True':'False'} and not can_run_sync():\n    raise RuntimeError(\"INTERACTIVE_JSPI_UNAVAILABLE\")\n_values = iter(${JSON.stringify(values)})\nclass _ConsoleOutput:\n    def write(self, text):\n        value = str(text)\n        if value: __console_out(value)\n        return len(value)\n    def flush(self): pass\n_old_input, _old_out, _old_err = builtins.input, sys.stdout, sys.stderr\ndef _ask(prompt=\"\"):\n    if ${prepared?'True':'False'}:\n        try: value = next(_values)\n        except StopIteration: raise EOFError('Falten entrades al programa.')\n        __console_out(str(prompt) + value + '\\n')\n        return value\n    return str(run_sync(__console_input(str(prompt))))\nbuiltins.input = _ask\nsys.stdout = sys.stderr = _ConsoleOutput()\ntry:\n    exec(compile(${JSON.stringify(source)}, \"<alumne>\", \"exec\"), {\"__name__\": \"__main__\"})\nexcept BaseException:\n    traceback.print_exc(limit=6)\nfinally:\n    builtins.input, sys.stdout, sys.stderr = _old_input, _old_out, _old_err\n`;\n     if(/\\bmatplotlib\\b/.test(source))await engine.loadPackage('matplotlib');\n     await engine.runPythonAsync(script);\n     emit('done');\n   }catch(error){\n     const message=String(error?.message||error||'Error desconegut');\n     emit(message.includes('INTERACTIVE_JSPI_UNAVAILABLE')?'unsupported':'error',{message:message.slice(0,1200)});\n   }finally{running=false}\n };\n})();"],{type:'text/javascript'}));
       child=new Worker(url);
       URL.revokeObjectURL(url);
       child.onmessage=e=>{const m=e.data||{};send(m.type,m)};
       child.onerror=e=>send('error',{message:String(e.message||'Error de l\x27executor')});
       child.postMessage({type:'start',code:msg.code});
     }catch(err){send('error',{message:String(err.message||err)})}
   }else if(msg.id===session&&msg.type==='answer'&&child){
     child.postMessage({type:'answer',value:msg.value});
   }else if(msg.id===session&&msg.type==='prepared'&&child){
     child.postMessage({type:'start',code:lastCode,mode:'prepared',values:msg.values});
   }
 });
 send('ready');
})();