// Terminal Python interactiu per a tots els capítols i per a la galeria.
// L'executor s'executa en un Worker dins d'un iframe sandbox sense same-origin.
const PythonConsole=(()=>{
 let active=null;
 function stop(){
  if(!active)return;
  const a=active;active=null;
  window.removeEventListener('message',a.listener);
  try{a.frame.remove()}catch{}
  if(a.form)a.form.hidden=true;
  if(a.stop)a.stop.disabled=true;
  if(a.status&&a.status.textContent.startsWith('Executant'))a.status.textContent='Execució interrompuda.';
 }
 function run(code,host){
  stop();
  if(!host)return;
  host.textContent='';
  const wrap=document.createElement('div');wrap.className='python-console';
  const head=document.createElement('div');head.className='python-console-head';
  const status=document.createElement('span');status.textContent='Preparant la consola…';
  const stopButton=document.createElement('button');stopButton.className='secondary mini-btn';stopButton.type='button';stopButton.textContent='■ Atura';
  head.append(status,stopButton);
  const output=document.createElement('pre');output.className='python-console-log';output.setAttribute('aria-live','polite');
  const form=document.createElement('form');form.className='python-console-input';form.hidden=true;
  const label=document.createElement('label');label.textContent='Resposta: ';
  const input=document.createElement('input');input.type='text';input.autocomplete='off';input.spellcheck=false;input.maxLength=3000;input.setAttribute('aria-label','Resposta al programa Python');
  const send=document.createElement('button');send.type='submit';send.textContent='Envia ↵';
  label.appendChild(input);form.append(label,send);
  const fallback=document.createElement('div');fallback.className='python-console-fallback';fallback.hidden=true;
  const help=document.createElement('p');help.textContent='Aquest navegador no admet les preguntes interactives de Python. Pots executar el programa amb respostes preparades, una per línia.';
  const batch=document.createElement('textarea');batch.rows=3;batch.placeholder='Una resposta per línia';
  const batchButton=document.createElement('button');batch.type='button';batchButton.textContent='Executa amb aquestes entrades';
  fallback.append(help,batch,batchButton);
  wrap.append(head,output,form,fallback);host.append(wrap);
  const frame=document.createElement('iframe');
  frame.src='/python-console-frame.html';frame.setAttribute('sandbox','allow-scripts');
  frame.setAttribute('referrerpolicy','no-referrer');frame.tabIndex=-1;frame.className='python-console-sandbox';
  const id=String(Date.now())+'-'+Math.random().toString(36).slice(2);
  const session={frame,id,listener:null,form,stop:stopButton,status,code:String(code||'').slice(0,30000),outputLength:0};
  active=session;
  const append=(s)=>{
   if(active!==session)return;
   const text=String(s||'');
   if(session.outputLength>=120000)return;
   const safe=text.slice(0,120000-session.outputLength);
   session.outputLength+=safe.length;
   output.appendChild(document.createTextNode(safe));
   output.scrollTop=output.scrollHeight;
   host.scrollTop=host.scrollHeight;
  };
  const sendMessage=(message)=>{try{frame.contentWindow?.postMessage({id,...message},'*')}catch{}};
  const resetInput=()=>{
   form.hidden=true;input.value='';
  };
  session.listener=e=>{
   if(active!==session||e.source!==frame.contentWindow)return;
   const m=e.data||{};
   if(m.pythonConsole!==true)return;
   if(m.type==='ready'){sendMessage({type:'start',code:session.code});status.textContent='Executant…';return}
   if(m.id!==id)return;
   if(m.type==='loading'){status.textContent='Carregant Python…';return}
   if(m.type==='output'){append(m.text);return}
   if(m.type==='input'){
    status.textContent='Esperant resposta…';
    resetInput();
    label.firstChild.textContent=String(m.prompt||'').slice(0,500)||'Resposta: ';
    form.hidden=false;
    input.focus();
    return;
   }
   if(m.type==='unsupported'){
    status.textContent='Mode compatible disponible';
    resetInput();
    fallback.hidden=false;
    append('\nAquest navegador no admet l’entrada interactiva. Utilitza les entrades preparades.\n');
    return;
   }
   if(m.type==='done'){
    status.textContent='✓ Programa acabat';
    resetInput();
    stopButton.disabled=true;
    return;
   }
   if(m.type==='error'){
    status.textContent='⚠ Error d’execució';
    resetInput();stopButton.disabled=true;
    append('\n'+String(m.message||'Error de Python')+'\n');
   }
  };
  window.addEventListener('message',session.listener);
  form.addEventListener('submit',e=>{
   e.preventDefault();
   if(active!==session||form.hidden)return;
   const value=input.value;
   append((label.firstChild.textContent||'')+value+'\n');
   resetInput();
   status.textContent='Executant…';
   sendMessage({type:'answer',value});
  });
  batchButton.addEventListener('click',()=>{
   if(active!==session)return;
   const values=batch.value.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n');
   fallback.hidden=true;output.textContent='';session.outputLength=0;
   status.textContent='Executant amb entrades preparades…';
   sendMessage({type:'prepared',values});
  });
  stopButton.addEventListener('click',()=>{append('\n■ Execució interrompuda.\n');stop()});
  host.appendChild(frame);
  return session;
 }
 return {run,stop};
})();
