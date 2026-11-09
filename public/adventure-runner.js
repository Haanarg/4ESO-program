/* Consola aïllada: només rep el codi, mai cookies o dades de sessió.
 * Cada resposta reprèn el programa reexecutant-lo des de l'inici amb les
 * entrades anteriors, perquè les funcions input() normals de Python són
 * síncrones. La sortida antiga se substitueix, no es duplica.
 */
let interpreter=null,source='',answers=[],running=false,revision=0;
const transcript=document.getElementById('transcript');
const promptBox=document.getElementById('prompt-box');
const promptText=document.getElementById('prompt');
const form=document.getElementById('answer-form');
const answerInput=document.getElementById('answer');
const statusNode=document.getElementById('status');
const MAX_ANSWERS=250, MAX_CODE=30000, MAX_OUTPUT=70000;
function state(message,kind=''){statusNode.textContent=message;statusNode.className=kind;}
function showInput(prompt){
 promptText.textContent=prompt||'El programa demana una resposta:';
 promptBox.style.display='flex';answerInput.disabled=false;answerInput.value='';
 answerInput.focus({preventScroll:true});
}
function resetUi(){promptBox.style.display='none';answerInput.value='';transcript.textContent='';}
async function loadPython(){
 if(interpreter)return interpreter;
 state('Carregant Python…');
 if(typeof loadPyodide!=='function')throw Error('No es pot carregar Pyodide (comprova la connexió).');
 interpreter=await loadPyodide();
 state('Python preparat.');
 return interpreter;
}
function wrapper(code,inputs){
 // Les entrades es tornen a proporcionar a la nova execució.
 return [
  'import io, contextlib, builtins',
  '__runner_out=io.StringIO()',
  '__runner_values=iter('+JSON.stringify(inputs)+')',
  '__runner_original_input=builtins.input',
  'class __RunnerNeedsInput(BaseException):',
  ' def __init__(self,prompt): self.prompt=str(prompt)',
  'def __runner_input(prompt=""):',
  ' try: value=next(__runner_values)',
  ' except StopIteration: raise __RunnerNeedsInput(prompt)',
  ' print(str(prompt)+str(value))',
  ' return value',
  'builtins.input=__runner_input',
  '__runner_ask=None',
  '__runner_err=""',
  'try:',
  ' with contextlib.redirect_stdout(__runner_out):',
  '  exec('+JSON.stringify(code)+',{"__name__":"__main__"})',
  'except __RunnerNeedsInput as e:',
  ' __runner_ask=e.prompt',
  'except BaseException as e:',
  ' __runner_err=type(e).__name__+": "+str(e)',
  'finally:',
  ' builtins.input=__runner_original_input',
  '(__runner_out.getvalue(),__runner_ask,__runner_err)'
 ].join('\n');
}
async function execute(){
 if(running||!source)return;
 const version=revision;
 running=true;promptBox.style.display='none';answerInput.disabled=true;
 state('Executant…');
 try{
  const py=await loadPython();
  if(version!==revision)return;
  if(/matplotlib/.test(source))await py.loadPackage('matplotlib');
  const result=await py.runPythonAsync(wrapper(source,answers));
  if(version!==revision)return;
  const output=String(result[0]||'');
  transcript.textContent=output.slice(0,MAX_OUTPUT)+(output.length>MAX_OUTPUT?'\n… (sortida retallada)':'');
  if(result[2]){state('Error: '+String(result[2]),'error');return;}
  if(result[1]!==null&&result[1]!==undefined){
   if(answers.length>=MAX_ANSWERS){state('Límit de 250 respostes assolit. Reinicia el programa.','error');return;}
   showInput(String(result[1]));
   state('Esperant una resposta…');
  }else state('✓ Programa finalitzat. Pots reiniciar-lo.','ready');
 }catch(error){if(version===revision)state('Error d’execució: '+(error?.message||error),'error')}
 finally{running=false;}
}
function begin(code){
 revision++;source=String(code||'').slice(0,MAX_CODE);answers=[];resetUi();
 if(!source.trim()){state('Aquest programa no conté codi.','error');return;}
 execute();
}
form.addEventListener('submit',e=>{
 e.preventDefault();if(running||promptBox.style.display==='none')return;
 answers.push(answerInput.value);execute();
});
document.getElementById('stop').addEventListener('click',()=>{
 // Aturar un programa mal format requereix destruir el context Pyodide.
 // Avisem la pàgina host perquè recreï el marc, no conservem l'estat.
 parent.postMessage({type:'python-interactive-reset'},'*');
 revision++;source='';answers=[];resetUi();state('Execució aturada.');
});
window.addEventListener('message',e=>{
 if(e.source!==parent||!e.data||e.data.type!=='python-interactive-run')return;
 begin(e.data.code);
});
parent.postMessage({type:'python-interactive-ready'},'*');
