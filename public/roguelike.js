/* Roguelike experimental: el dibuix es fa en Canvas i tota la lògica en Python. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const canvas=$('game-canvas'),ctx=canvas.getContext('2d',{alpha:false});
 const status=$('game-status'),notice=$('game-message'),hp=$('game-hp'),
       turns=$('game-turns'),key=$('game-key'),start=$('new-game'),
       switchServer=$('switch-server'),fallback=$('game-fallback');
 const TILE=32;
 let worker=null,serial=0,world=null,busy=true,timer=null,warnTimer=null,cdnIndex=0;
 const RESERVED=new Set(['w','a','s','d']),MOVEMENT=new Set(['amunt','avall','esquerra','dreta']);
 let customActions=new Map(),lastActionSignature='';
 function drawCustomControls(raw){
  const data=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const actions=[];
  for(const [key,value] of Object.entries(data)){
   const k=key.trim().toLowerCase();
   if(!/^(?:[a-z0-9]|espai|enter)$/.test(k)||RESERVED.has(k)||actions.some(a=>a.key===k))continue;
   const action=typeof value==='string'?value:value?.accio;
   if(typeof action!=='string'||!/^[a-z][a-z0-9_]{0,31}$/.test(action))continue;
   const label=typeof value==='object'&&typeof value?.etiqueta==='string'&&value.etiqueta.trim()
    ?value.etiqueta.trim().slice(0,42):action.replace(/_/g,' ');
   actions.push({key:k,action,label});
   if(actions.length>=12)break;
  }
  const signature=JSON.stringify(actions);
  if(signature===lastActionSignature)return;
  lastActionSignature=signature;customActions=new Map(actions.map(a=>[a.key,a.action]));
  const host=$('game-custom-actions');if(!host)return;
  host.replaceChildren();host.hidden=actions.length===0;
  for(const a of actions){
   const button=document.createElement('button');button.type='button';
   button.className='secondary';
   button.textContent=a.label+' ['+(a.key==='espai'?'Espai':a.key==='enter'?'Enter':a.key.toUpperCase())+']';
   button.addEventListener('click',()=>sendAction(a.action));
   host.appendChild(button);
  }
 }
 ctx.imageSmoothingEnabled=false;
 function setStatus(text){status.textContent=text}
 function clearTimers(){clearTimeout(timer);clearTimeout(warnTimer);timer=null;warnTimer=null}
 function error(text){
  busy=true;clearTimers();setStatus('⚠ Error de càrrega');
  notice.textContent=text;fallback.hidden=false;start.disabled=false;
 }
 function startWorker(index=0){
  clearTimers();if(worker){worker.terminate();worker=null;}
  serial++;const id=serial;world=null;busy=true;cdnIndex=index;drawCustomControls({});
  start.disabled=true;fallback.hidden=true;notice.textContent='Preparant la masmorra…';
  setStatus(index?'Servidor alternatiu: carregant Python…':'Carregant Python…');
  renderSplash();
  let w;
  try{w=new Worker('/roguelike-worker.js?v=20261111-actions-v1')}catch(e){error('Aquest navegador no admet el motor del joc: '+e.message);return;}
  worker=w;
  const current=()=>id===serial&&worker===w;
  w.onmessage=event=>{
   if(!current())return;
   const msg=event.data||{};
   if(msg.type==='loading'){setStatus(msg.message||'Carregant Python…');return;}
   if(msg.type==='ready'){clearTimers();setStatus('Python carregat. Preparant la partida…');return;}
   if(msg.type==='state'){
    clearTimers();world=msg.state;busy=false;start.disabled=false;drawCustomControls(world.controls);
    setStatus(world.estat==='jugant'?'● Partida en curs':world.estat==='victoria'?'★ Victòria':'✖ Partida acabada');
    notice.textContent=String(world.missatge||'');
    hp.textContent='♥ '+world.vida+' / '+world.vida_max;
    turns.textContent='Torns: '+world.torns;
    key.textContent=world.te_clau?'🗝 Clau obtinguda':'🗝 Troba la clau';
    draw(world);return;
   }
   if(msg.type==='error'){
    if(msg.stage==='loading'&&index===0){startWorker(1);return;}
    error('No s’ha pogut executar el joc: '+String(msg.message||'Error desconegut'));
   }
  };
  w.onerror=event=>{
   if(!current())return;
   event.preventDefault?.();
   if(index===0)startWorker(1);
   else error('No s’ha pogut iniciar el motor del joc. Comprova la connexió i actualitza la pàgina.');
  };
  w.postMessage({type:'init',cdnIndex:index});
  warnTimer=setTimeout(()=>{
   if(current()&&!world)setStatus('La càrrega és lenta; pots provar el servidor alternatiu.');
  },18000);
  timer=setTimeout(()=>{
   if(!current()||world)return;
   if(index===0)startWorker(1);
   else error('Python no respon als dos servidors. La xarxa pot bloquejar Pyodide; prova una altra connexió.');
  },index===0?55000:85000);
 }
 function sendAction(action){
  if(!world||busy||world.estat!=='jugant'||!worker)return;
  if(!MOVEMENT.has(action)&&![...customActions.values()].includes(action))return;
  busy=true;worker.postMessage(MOVEMENT.has(action)?{type:'move',direction:action}:{type:'action',action});
 }
 function newGame(){
  if(!worker||!world){startWorker(cdnIndex);return;}
  busy=true;setStatus('Reiniciant partida…');worker.postMessage({type:'new'});
 }
 function noise(x,y,salt){let n=(x*374761393+y*668265263+salt*2246822519)|0;n=(n^(n>>>13))*1274126177;return ((n^(n>>>16))>>>0)%1000;}
 function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h))}
 function drawTile(x,y,isWall){
  const px=x*TILE,py=y*TILE;
  if(isWall){
   rect(px,py,TILE,TILE,'#34445a');
   rect(px,py,TILE,3,'#53617a');
   rect(px+1,py+5,TILE-2,2,'#212d43');
   rect(px,py+17,TILE,2,'#202b3d');
   rect(px+15,py+5,2,12,'#202b3d');
   rect(px+9,py+19,2,12,'#1f2a3b');
   rect(px+3,py+8,5,2,noise(x,y,1)>500?'#45526c':'#38485c');
  }else{
   rect(px,py,TILE,TILE,noise(x,y,1)>790?'#232c35':'#202832');
   rect(px,py,TILE,1,'#2b3540');
   if(noise(x,y,3)>430)rect(px+5,py+8,3,2,'#333c43');
   if(noise(x,y,2)>500)rect(px+21,py+23,4,2,'#2f3b43');
   if(noise(x,y,4)>660)rect(px+14,py+16,2,2,'#394248');
  }
 }
 function ellipse(cx,cy,rx,ry,color){
  ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fill();
 }
 function player(x,y){
  const px=x*TILE,py=y*TILE;
  ellipse(px+16,py+26,10,4,'#101923');
  rect(px+10,py+14,12,12,'#3b96aa');
  rect(px+10,py+20,12,6,'#21667e');
  rect(px+12,py+5,8,10,'#f3b982');
  rect(px+11,py+4,10,4,'#e8c75f');
  rect(px+13,py+9,2,2,'#303448');rect(px+18,py+9,2,2,'#303448');
  rect(px+8,py+17,3,10,'#b67c4e');
  rect(px+20,py+17,4,8,'#ddb962');
  rect(px+10,py+26,5,3,'#20253b');rect(px+18,py+26,5,3,'#20253b');
 }
 function enemy(x,y){
  const px=x*TILE,py=y*TILE;
  ellipse(px+16,py+26,12,4,'#161721');
  rect(px+6,py+11,20,13,'#ab455e');
  rect(px+9,py+7,14,5,'#e06a79');
  rect(px+4,py+20,24,6,'#872c4e');
  rect(px+11,py+15,3,4,'#fff4db');
  rect(px+19,py+15,3,4,'#fff4db');
  rect(px+12,py+16,1,2,'#2b2739');rect(px+20,py+16,1,2,'#2b2739');
 }
 function treasure(x,y){
  const px=x*TILE,py=y*TILE;
  ellipse(px+16,py+25,10,3,'#151f25');
  rect(px+7,py+12,16,4,'#ffc94d');
  rect(px+9,py+16,5,4,'#b98121');
  rect(px+14,py+8,4,13,'#f6d66b');
  rect(px+18,py+8,6,4,'#f6d66b');
  rect(px+16,py+10,2,2,'#fff8c3');
 }
 function door(x,y){
  const px=x*TILE,py=y*TILE;
  rect(px+3,py+2,26,28,'#737b8b');
  rect(px+6,py+6,20,24,'#855639');
  rect(px+8,py+9,16,21,'#6a402e');
  rect(px+12,py+8,2,22,'#a16d44');rect(px+21,py+8,2,22,'#a16d44');
  rect(px+21,py+19,3,3,'#e6bb58');
 }
 function potion(x,y){
  const px=x*TILE,py=y*TILE;
  ellipse(px+16,py+27,9,3,'#15212b');
  rect(px+12,py+8,8,5,'#d1c5a2');
  rect(px+10,py+13,12,14,'#7ccde5');
  rect(px+12,py+17,8,8,'#e56f93');
  rect(px+13,py+16,3,4,'#ffd0d7');
 }
 function draw(state){
  const map=state.mapa;
  const width=map[0].length,height=map.length;
  if(width*TILE!==canvas.width||height*TILE!==canvas.height){
   canvas.width=width*TILE;canvas.height=height*TILE;ctx.imageSmoothingEnabled=false;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)drawTile(x,y,map[y][x]==='#');
  door(...state.porta);
  if(state.clau)treasure(...state.clau);
  for(const p of state.pocions||[])potion(...p);
  for(const e of state.enemics||[])enemy(e.x,e.y);
  player(...state.jugador);
  if(state.estat!=='jugant'){
   ctx.fillStyle='rgba(5,9,18,0.76)';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.textAlign='center';ctx.font='bold 30px system-ui';
   ctx.fillStyle=state.estat==='victoria'?'#f7d479':'#fb9da5';
   ctx.fillText(state.estat==='victoria'?'HAS ESCAPAT!':'HAS CAIGUT!',canvas.width/2,canvas.height/2);
   ctx.font='16px system-ui';ctx.fillStyle='#e5e7ee';
   ctx.fillText('Prem «Nova partida» per tornar a jugar.',canvas.width/2,canvas.height/2+35);
  }
 }
 function renderSplash(){
  ctx.fillStyle='#141d2b';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#a5b9cf';ctx.textAlign='center';ctx.font='20px system-ui';
  ctx.fillText('Preparant la masmorra…',canvas.width/2,canvas.height/2);
 }
 const controls={ArrowUp:'amunt',ArrowDown:'avall',ArrowLeft:'esquerra',ArrowRight:'dreta',
   w:'amunt',s:'avall',a:'esquerra',d:'dreta',W:'amunt',S:'avall',A:'esquerra',D:'dreta'};
 document.addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.repeat||e.target?.matches?.('input,textarea,[contenteditable]'))return;
  if((e.key==='Enter'||e.key===' ')&&e.target?.closest?.('button'))return;
  const k=e.key===' '?'espai':e.key==='Enter'?'enter':e.key.length===1?e.key.toLowerCase():null;
  const action=controls[e.key]||customActions.get(k);
  if(action){e.preventDefault();sendAction(action);}
 });
 document.querySelectorAll('[data-move]').forEach(button=>{
  button.addEventListener('click',()=>sendAction(button.dataset.move));
 });
 start.addEventListener('click',newGame);
 switchServer.addEventListener('click',()=>startWorker(cdnIndex===0?1:0));
 $('retry-game').addEventListener('click',()=>startWorker(1));
 window.addEventListener('pagehide',()=>{clearTimers();worker?.terminate();});
 renderSplash();startWorker();
})();
