/* Executor Python aïllat. Es carrega dins un Worker creat per un iframe sandbox. */
(function(){
 const CDN='https://cdn.jsdelivr.net/pyodide/v0.28.2/full/';
 let engine=null, running=false, pending=null;
 const emit=(type,detail={})=>self.postMessage({type,...detail});
 self.__console_out=text=>emit('output',{text:String(text).slice(0,15000)});
 self.__console_input=prompt=>new Promise((resolve,reject)=>{
   if(pending){reject(Error('Ja hi ha una entrada pendent.'));return;}
   pending={resolve,reject};
   emit('input',{prompt:String(prompt).slice(0,500)});
 });
 self.onmessage=async e=>{
   const msg=e.data||{};
   if(msg.type==='answer'&&pending){
     const request=pending;pending=null;
     request.resolve(String(msg.value??'').slice(0,3000));
     return;
   }
   if(msg.type!=='start'||running)return;
   running=true;
   try{
     emit('loading');
     if(!engine){
       importScripts(CDN+'pyodide.js');
       engine=await loadPyodide({indexURL:CDN});
     }
     const source=String(msg.code||'').slice(0,30000);
     const script=`import builtins, sys, traceback
from pyodide.ffi import run_sync, can_run_sync
from js import __console_out, __console_input
if not can_run_sync():
    raise RuntimeError("INTERACTIVE_JSPI_UNAVAILABLE")
class _ConsoleOutput:
    def write(self, text):
        value = str(text)
        if value: __console_out(value)
        return len(value)
    def flush(self): pass
_old_input, _old_out, _old_err = builtins.input, sys.stdout, sys.stderr
def _ask(prompt=""):
    return str(run_sync(__console_input(str(prompt))))
builtins.input = _ask
sys.stdout = sys.stderr = _ConsoleOutput()
try:
    exec(compile(${JSON.stringify(source)}, "<alumne>", "exec"), {"__name__": "__main__"})
except BaseException:
    traceback.print_exc(limit=6)
finally:
    builtins.input, sys.stdout, sys.stderr = _old_input, _old_out, _old_err
`;
     if(/\bmatplotlib\b/.test(source))await engine.loadPackage('matplotlib');
     await engine.runPythonAsync(script);
     emit('done');
   }catch(error){
     const message=String(error?.message||error||'Error desconegut');
     emit(message.includes('INTERACTIVE_JSPI_UNAVAILABLE')?'unsupported':'error',{message:message.slice(0,1200)});
   }finally{running=false}
 };
})();