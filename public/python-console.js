// Consola Python compartida: càrrega sota demanda, CDN alternatiu i reexecució ràpida.
const PythonConsole=(()=>{
 const RUNNER_VERSION='20261110-py-load-v1';
 let active=null;
 function clearTimers(s){for(const k of ['bootTimer','warnTimer','loadTimer']){clearTimeout(s[k]);s[k]=null;}}
 function stop(){
  if(!active)return;
  const a=active;active=null;
  clearTimers(a);
  window.removeEventListener('message',a.listener);
  try{a.frame.contentWindow?.postMessage({id:a.id,type:'stop'},'*')}catch{}
  try{a.frame.remove()}catch{}
  if(a.form)a.form.hidden=true;
  if(a.stopButton)a.stopButton.disabled=true;
  if(a.status&&a.status.textContent.startsWith('Executant'))a.status.textContent='Execució interrompuda.';
 }
 function run(code,host,options={}){
  if(!host)return;
  const source=String(code||'').slice(0,30000);
  // Si tornem a executar el mateix exercici després d'acabar, conservem el
  // WebAssembly i el Python ja carregats; no compartim sessions entre pantalles.
  if(active&&active.host===host&&active.done&&!options.forceNew){
   const a=active;
   a.code=source;a.done=false;a.stage='execution';a.outputLength=0;
   a.output.textContent='';a.form.hidden=true;a.input.value='';
   a.stopButton.disabled=false;a.status.textContent='Executant de nou amb Python ja carregat…';
   a.send({type:'restart',code:source,cdnIndex:a.cdnIndex});
   return a;
  }
  stop();
  host.textContent='';
  const cdnIndex=Number(options.cdnIndex)===1?1:0;
  const wrap=document.createElement('div');wrap.className='python-console';
  const head=document.createElement('div');head.className='python-console-head';
  const status=document.createElement('span');status.textContent=cdnIndex===0?'Preparant la consola Python…':'Preparant el servidor alternatiu…';
  status.setAttribute('role','status');
  const alternateButton=document.createElement('button');
  alternateButton.className='secondary mini-btn';alternateButton.type='button';
  alternateButton.textContent=cdnIndex===0?'🌐 Servidor alternatiu':'↻ Torna a provar';
  alternateButton.title='Torna a iniciar Python utilitzant un altre servidor de descàrrega.';
  const stopButton=document.createElement('button');stopButton.className='secondary mini-btn';
  stopButton.type='button';stopButton.textContent='■ Atura';
  head.append(status,alternateButton,stopButton);
  const output=document.createElement('pre');output.className='python-console-log';
  output.setAttribute('aria-live','polite');
  output.textContent='La primera vegada s’han de descarregar els components de Python. Les execucions següents en aquesta pantalla seran més ràpides.';
  const form=document.createElement('form');form.className='python-console-input';form.hidden=true;
  const label=document.createElement('label');label.textContent='Resposta: ';
  const input=document.createElement('input');input.type='text';input.autocomplete='off';
  input.spellcheck=false;input.maxLength=3000;input.setAttribute('aria-label','Resposta al programa Python');
  const sendButton=document.createElement('button');sendButton.type='submit';sendButton.textContent='Envia ↵';
  label.appendChild(input);form.append(label,sendButton);
  wrap.append(head,output,form);host.append(wrap);
  const frame=document.createElement('iframe');
  frame.src='/python-console-frame.html?v=20261110-py-load-v1';
  frame.setAttribute('sandbox','allow-scripts');
  frame.setAttribute('referrerpolicy','no-referrer');frame.setAttribute('aria-hidden','true');
  frame.style.display='none';frame.hidden=true;frame.tabIndex=-1;frame.className='python-console-sandbox';
  const id=String(Date.now())+'-'+Math.random().toString(36).slice(2);
  const a={host,code:source,cdnIndex,id,frame,form,input,output,status,stopButton,alternateButton,
    listener:null,bootTimer:null,warnTimer:null,loadTimer:null,done:false,stage:'boot',engineReady:false,outputLength:0,ready:false,send:null};
  active=a;
  function append(value){
   if(active!==a)return;
   const v=String(value??'').slice(0,Math.max(0,120000-a.outputLength));
   a.outputLength+=v.length;output.appendChild(document.createTextNode(v));
   output.scrollTop=output.scrollHeight;host.scrollTop=host.scrollHeight;
  }
  function fail(message){
   if(active!==a)return;
   clearTimers(a);status.textContent='⚠ No s’ha pogut carregar Python';
   append('\n'+message+'\n');
   form.hidden=true;
   stop();
  }
  function retryAlternative(){
   if(active!==a)return;
   run(a.code,host,{cdnIndex:1,forceNew:true});
  }
  function warnSlow(){
   if(active!==a||a.engineReady||a.stage==='execution'||a.done)return;
   status.textContent='La càrrega és lenta. Pots provar el servidor alternatiu.';
  }
  function loadExpired(){
   if(active!==a||a.done||a.engineReady||a.stage==='execution')return;
   if(a.cdnIndex===0)retryAlternative();
   else fail('No s’ha pogut carregar Python amb cap dels dos servidors. Comprova la connexió, actualitza el navegador o demana al professor que revisi si la xarxa bloqueja els CDN.');
  }
  function beginWatch(){
   clearTimeout(a.warnTimer);clearTimeout(a.loadTimer);
   a.warnTimer=setTimeout(warnSlow,18000);
   a.loadTimer=setTimeout(loadExpired,a.cdnIndex===0?55000:85000);
  }
  a.send=message=>{
   try{frame.contentWindow?.postMessage({id,...message},'*')}
   catch(error){fail('No es pot contactar amb el motor Python: '+String(error?.message||error));}
  };
  a.listener=e=>{
   if(active!==a||e.source!==frame.contentWindow)return;
   const m=e.data||{};
   if(m.pythonConsole!==true)return;
   if(m.type==='ready'){
    if(m.version!==RUNNER_VERSION){
     fail('La consola antiga està desada al navegador. Actualitza la pàgina amb Ctrl+F5.');return;
    }
    a.ready=true;clearTimeout(a.bootTimer);a.stage='loading';
    status.textContent=cdnIndex===0?'Descarregant Python…':'Descarregant Python des del servidor alternatiu…';
    a.send({type:'start',code:a.code,cdnIndex});beginWatch();
    return;
   }
   if(m.id!==id)return;
   if(m.type==='loading'){
    a.stage=m.stage||'loading';
    if(a.stage==='execution'){clearTimeout(a.warnTimer);clearTimeout(a.loadTimer);}
    status.textContent=String(m.message||'Carregant Python…');
    return;
   }
   if(m.type==='engine_ready'){
    a.engineReady=true;clearTimeout(a.warnTimer);clearTimeout(a.loadTimer);
    status.textContent='Python preparat.';
    return;
   }
   if(m.type==='replace'){
    output.textContent=String(m.text||'');a.outputLength=output.textContent.length;
    output.scrollTop=output.scrollHeight;host.scrollTop=host.scrollHeight;return;
   }
   if(m.type==='output'){append(m.text);return;}
   if(m.type==='input'){
    clearTimers(a);
    a.stage='input';status.textContent='Esperant resposta…';
    input.value='';label.firstChild.textContent=String(m.prompt||'').slice(0,500)||'Resposta: ';
    form.hidden=false;input.focus();return;
   }
   if(m.type==='done'){
    clearTimers(a);a.done=true;a.stage='done';
    if(!output.textContent.trim())output.textContent='El programa ha acabat sense mostrar missatges ni demanar cap entrada. Comprova si has afegit print() o input().';
    status.textContent='✓ Programa acabat. Pots prémer Executar de nou sense tornar a descarregar Python.';
    form.hidden=true;stopButton.disabled=true;return;
   }
   if(m.type==='error'){
    if(m.stage==='loading'&&!a.engineReady&&cdnIndex===0){retryAlternative();return;}
    clearTimers(a);a.done=a.engineReady;a.stage='error';
    status.textContent='⚠ '+(m.stage==='loading'?'No s’ha pogut carregar Python':'Error d’execució');
    form.hidden=true;stopButton.disabled=true;
    append('\n'+String(m.message||'Error de Python')+'\n');
   }
  };
  window.addEventListener('message',a.listener);
  form.addEventListener('submit',e=>{
   e.preventDefault();
   if(active!==a||form.hidden)return;
   const value=input.value;append((label.firstChild.textContent||'')+value+'\n');
   form.hidden=true;input.value='';a.stage='execution';
   status.textContent='Executant…';a.send({type:'answer',value});
  });
  alternateButton.addEventListener('click',()=>{
   run(a.code,host,{cdnIndex:a.cdnIndex===0?1:0,forceNew:true});
  });
  stopButton.addEventListener('click',()=>{append('\n■ Execució interrompuda.\n');stop();});
  host.appendChild(frame);
  a.bootTimer=setTimeout(()=>{
   if(active!==a||a.ready)return;
   if(a.cdnIndex===0)retryAlternative();
   else fail('El navegador no ha pogut iniciar la consola. Actualitza la pàgina i torna-ho a provar.');
  },20000);
  return a;
 }
 return {run,stop};
})();
