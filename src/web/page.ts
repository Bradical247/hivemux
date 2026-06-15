// cmux-style GUI: sidebar of agent workspaces (status/notification rings) + a
// main pane with the selected agent's live terminal (embedded ttyd iframe) and a
// toolbar. Next-level create flow (live repo validation, repo picker, advanced
// options, real creating-state) plus sound chimes, desktop notifications,
// keyboard shortcuts, toasts, and a waiting-count title badge. Live over SSE.
// `"__AMUX_TOKEN__"` is replaced server-side with the auth token (or "").
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>amux</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--bd:#30363d;--fg:#e6edf3;--mut:#8b949e;
        --grn:#3fb950;--ylw:#d29922;--cyn:#39c5cf;--red:#f85149;--gry:#6e7681;--sel:#1f2937}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--fg);font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
       display:flex;height:100vh;overflow:hidden}
  button{background:#21262d;color:var(--fg);border:1px solid var(--bd);border-radius:6px;
         padding:5px 10px;cursor:pointer;font:inherit;font-size:12px}
  button:hover:not(:disabled){border-color:var(--mut)}
  button:disabled{opacity:.5;cursor:default}
  input,select{background:#010409;color:var(--fg);border:1px solid var(--bd);border-radius:6px;
       padding:7px 9px;font:inherit;font-size:13px;width:100%}

  .side{width:264px;min-width:264px;background:#0b0e13;border-right:1px solid var(--bd);display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--bd);font-weight:700;font-size:16px}
  .brand .dot{width:8px;height:8px;border-radius:50%;background:var(--gry)}
  .brand .dot.live{background:var(--grn);box-shadow:0 0 8px var(--grn)}
  .brand .sp{flex:1}
  .brand .snd{background:none;border:0;font-size:15px;padding:2px 4px}
  .side .new{margin:12px}
  .list{flex:1;overflow:auto;padding:0 8px}
  .ws{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;margin-bottom:4px}
  .ws:hover{background:#11161d}
  .ws.sel{background:var(--sel);outline:1px solid var(--bd)}
  .ring{width:10px;height:10px;border-radius:50%;flex:none;background:var(--gry)}
  .ring.running{background:var(--grn)}
  .ring.waiting{background:var(--ylw);animation:pulse 1.4s infinite}
  .ring.done{background:var(--cyn)}
  .ring.error{background:var(--red);animation:pulse 1.4s infinite}
  .ring.dead{background:var(--gry)}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(210,153,34,.6)}70%{box-shadow:0 0 0 7px rgba(210,153,34,0)}100%{box-shadow:0 0 0 0 rgba(210,153,34,0)}}
  .ws .meta{min-width:0;flex:1}
  .ws .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ws .sub{color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ws .warn{color:var(--red)}
  .conf{border-top:1px solid var(--bd);padding:10px 14px;font-size:12px;color:var(--red);max-height:30%;overflow:auto}
  .conf .f{color:var(--mut);font-size:11px}

  .main{flex:1;display:flex;flex-direction:column;min-width:0}
  .top{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bd)}
  .top .cur{font-weight:700}
  .top .cur small{color:var(--mut);font-weight:400;margin-left:8px}
  .top .sp{flex:1}
  .top input{width:210px}
  .stage{flex:1;position:relative;background:#010409}
  iframe{border:0;width:100%;height:100%;display:none;background:#010409}
  .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--mut);flex-direction:column;gap:8px;text-align:center}
  .empty kbd{background:#161b22;border:1px solid var(--bd);border-radius:4px;padding:1px 6px}

  .modal{position:fixed;inset:0;background:rgba(1,4,9,.7);display:none;align-items:center;justify-content:center;z-index:10}
  .modal.open{display:flex}
  .sheet{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:20px;width:380px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .sheet h3{margin:0}
  .field label{display:block;color:var(--mut);font-size:11px;margin-bottom:4px}
  .rs{font-size:12px;min-height:16px;color:var(--mut)}
  .rs.ok{color:var(--grn)} .rs.err{color:var(--red)}
  .adv{color:var(--cyn);font-size:12px;cursor:pointer;user-select:none}
  .advbox{display:none;flex-direction:column;gap:10px}
  .advbox.open{display:flex}
  .ferr{color:var(--red);font-size:12px;min-height:14px}
  .row2{display:flex;gap:8px;justify-content:flex-end}
  .spin{display:inline-block;width:11px;height:11px;border:2px solid #fff3;border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-1px}
  @keyframes spin{to{transform:rotate(360deg)}}

  .toasts{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:20}
  .toast{background:var(--card);border:1px solid var(--bd);border-left-width:3px;border-radius:8px;padding:10px 14px;font-size:13px;
         box-shadow:0 8px 24px rgba(0,0,0,.4);animation:slide .2s ease}
  .toast.ok{border-left-color:var(--grn)} .toast.warn{border-left-color:var(--ylw)} .toast.err{border-left-color:var(--red)} .toast.info{border-left-color:var(--cyn)}
  @keyframes slide{from{transform:translateX(20px);opacity:0}to{transform:none;opacity:1}}
</style>
</head>
<body>
<aside class="side">
  <div class="brand"><span class="dot" id="live"></span> amux <span id="count" style="color:var(--mut);font-weight:400;font-size:12px"></span>
    <span class="sp"></span><button class="snd" id="snd" title="sound on/off">🔔</button></div>
  <button class="new" id="newbtn">+ new agent <span style="color:var(--mut)">(n)</span></button>
  <div class="list" id="list"></div>
  <div class="conf" id="conf" style="display:none"><b>⚠ conflicts</b><div id="conflist"></div></div>
</aside>
<section class="main">
  <div class="top">
    <span class="cur" id="cur">no agent selected</span>
    <span class="sp"></span>
    <span id="totalcost" style="color:var(--mut);font-size:12px"></span>
    <input id="bcast" placeholder="broadcast to agent…" />
    <button id="bcastbtn">send</button>
    <button id="mergebtn">merge</button>
    <button id="prbtn">PR</button>
    <button id="killbtn">kill</button>
  </div>
  <div class="stage">
    <iframe id="term" title="terminal"></iframe>
    <div class="empty" id="empty">▦<br/>select an agent, or press <kbd>n</kbd> for a new one</div>
  </div>
</section>

<div class="modal" id="modal">
  <form class="sheet" id="newform">
    <h3>new agent</h3>
    <div class="field"><label>name</label><input id="f_name" placeholder="fix-auth" autocomplete="off" required /></div>
    <div class="field"><label>agent</label><select id="f_agent"></select></div>
    <div class="field"><label>repo</label>
      <input id="f_repo" list="repos" placeholder="." value="." autocomplete="off" />
      <datalist id="repos"></datalist>
      <div class="rs" id="repostat"></div>
    </div>
    <span class="adv" id="advtoggle">▸ advanced (branch / base)</span>
    <div class="advbox" id="advbox">
      <div class="field"><label>branch</label><input id="f_branch" placeholder="amux/<name>" autocomplete="off" /></div>
      <div class="field"><label>base ref</label><input id="f_base" placeholder="(default)" autocomplete="off" /></div>
    </div>
    <div class="ferr" id="f_err"></div>
    <div class="row2"><button type="button" id="cancel">cancel</button><button type="submit" id="createbtn">create</button></div>
  </form>
</div>
<div class="toasts" id="toasts"></div>

<script>
const TOKEN="__AMUX_TOKEN__";
const AUTH=TOKEN?{'x-amux-token':TOKEN}:{};
const Q=TOKEN?('?token='+encodeURIComponent(TOKEN)):'';
if(TOKEN&&location.search){history.replaceState(null,'',location.pathname);}
function api(p,o){o=o||{};o.headers=Object.assign({},o.headers||{},AUTH);return fetch(p,o);}
function postJSON(p,b){return api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
const $=id=>document.getElementById(id);

let agents=[],selected=null,conflicted=new Set(),prevStatus={},usage={};

/* ---- sound + notifications ---- */
let SOUND=localStorage.getItem('amux_sound')!=='off';
let AC=null;
const CHIME={waiting:[[660,.12],[880,.16]],done:[[880,.1],[1320,.18]],error:[[330,.2],[220,.26]],new:[[523,.08],[784,.14]]};
function beep(seq){
  if(!SOUND)return;
  try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();let t=AC.currentTime;
    seq.forEach(([f,d])=>{const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=f;
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.16,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+d);
      o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+d);t+=d;});}catch(e){}
}
function notify(title,body){
  try{if(window.Notification&&Notification.permission==='granted')new Notification(title,{body:body||'',silent:true});}catch(e){}
}
function arm(){ if(AC&&AC.state==='suspended')AC.resume(); if(window.Notification&&Notification.permission==='default')Notification.requestPermission(); }
$('snd').onclick=()=>{SOUND=!SOUND;localStorage.setItem('amux_sound',SOUND?'on':'off');$('snd').textContent=SOUND?'🔔':'🔕';if(SOUND){arm();beep(CHIME.new);}};
$('snd').textContent=SOUND?'🔔':'🔕';

/* ---- toasts ---- */
function toast(msg,kind){
  const t=document.createElement('div');t.className='toast '+(kind||'info');t.textContent=msg;
  $('toasts').appendChild(t);setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),200);},3200);
}

/* ---- sidebar ---- */
function renderList(){
  $('count').textContent=agents.length?('· '+agents.length):'';
  $('list').innerHTML=agents.map(a=>\`
    <div class="ws \${a.name===selected?'sel':''}" onclick="select('\${esc(a.name)}')">
      <span class="ring \${a.status}"></span>
      <span class="meta">
        <div class="nm">\${esc(a.name)} \${conflicted.has(a.name)?'<span class="warn">⚠</span>':''}</div>
        <div class="sub">\${esc(a.status)} · \${esc(a.branch)}\${a.note?' · '+esc(a.note):''}</div>
        \${usageLine(a.name)}
      </span>
    </div>\`).join('')||'<div style="color:var(--mut);padding:14px">no agents yet — press <b>n</b></div>';
}
function usageLine(name){
  const r=usage[name]; if(!r)return '';
  const u=r.usageView; if(u.source==='none')return '';
  const cost=u.costUSD!=null?('$'+u.costUSD.toFixed(3)):'';
  const ctx=u.ctxPct!=null?(' · '+u.ctxPct+'% ctx'):'';
  const warn=(r.overCost||r.overCtx)?' <span class="warn">⚠</span>':'';
  return \`<div class="sub" style="color:var(--cyn)">\${(u.inTok+u.outTok).toLocaleString()} tok\${ctx} \${cost}\${warn}</div>\`;
}
async function select(name){
  selected=name;const a=agents.find(x=>x.name===name);
  $('cur').innerHTML=esc(name)+(a?\` <small>\${esc(a.branch)} · \${esc(a.status)}</small>\`:'');
  renderList();
  const term=$('term'),empty=$('empty');
  try{
    const r=await api('/api/term/'+encodeURIComponent(name));const j=await r.json();
    if(!r.ok)throw new Error(j.error||'failed');
    term.src='http://'+location.hostname+':'+j.port;term.style.display='block';empty.style.display='none';
  }catch(e){term.style.display='none';empty.style.display='flex';empty.innerHTML='▦<br/>'+esc(e.message);}
}
async function loadConflicts(){
  const cs=await (await api('/api/conflicts')).json();
  conflicted=new Set(cs.flatMap(c=>c.agents));
  $('conf').style.display=cs.length?'block':'none';
  $('conflist').innerHTML=cs.map(c=>\`<div style="margin-top:6px">\${esc(c.file)}<div class="f">← \${c.agents.map(esc).join(', ')}</div></div>\`).join('');
  renderList();
}

/* ---- toolbar ---- */
$('bcastbtn').onclick=async()=>{if(!selected)return;const t=$('bcast').value.trim();if(!t)return;await postJSON('/api/broadcast',{names:[selected],text:t});$('bcast').value='';toast('sent to '+selected,'info');};
$('mergebtn').onclick=async()=>{if(!selected)return;const r=await postJSON('/api/merge',{name:selected});const j=await r.json();j.merged?toast('merged '+selected+' → '+j.into,'ok'):toast('conflicts: '+((j.conflicts||[]).join(', ')||j.error),'err');};
$('prbtn').onclick=async()=>{if(!selected)return;const r=await postJSON('/api/pr',{name:selected});const j=await r.json();j.url?toast('PR: '+j.url,'ok'):toast(j.error||'failed','err');};
$('killbtn').onclick=async()=>{if(!selected)return;if(!confirm('kill '+selected+'?'))return;const n=selected;await postJSON('/api/kill',{name:n,rmWorktree:false});selected=null;$('term').style.display='none';$('empty').style.display='flex';$('cur').textContent='no agent selected';toast('killed '+n,'warn');};

/* ---- new-agent modal ---- */
function openModal(){arm();$('repos').innerHTML=[...new Set(agents.map(a=>a.repo))].map(r=>\`<option value="\${esc(r)}">\`).join('');$('modal').classList.add('open');$('f_name').focus();checkRepo();}
function closeModal(){$('modal').classList.remove('open');$('f_err').textContent='';}
$('newbtn').onclick=openModal;
$('cancel').onclick=closeModal;
$('modal').onclick=e=>{if(e.target===$('modal'))closeModal();};
$('advtoggle').onclick=()=>{const b=$('advbox');b.classList.toggle('open');$('advtoggle').textContent=(b.classList.contains('open')?'▾':'▸')+' advanced (branch / base)';};

let repoTimer,repoOK=true;
function checkRepo(){
  const p=$('f_repo').value.trim()||'.';clearTimeout(repoTimer);
  const st=$('repostat');st.textContent='checking…';st.className='rs';
  repoTimer=setTimeout(async()=>{
    try{const j=await (await api('/api/repo-check?path='+encodeURIComponent(p))).json();
      if(j.valid){st.textContent='✓ '+j.name+' · '+j.branch;st.className='rs ok';repoOK=true;}
      else{st.textContent='✗ '+(j.error||'invalid');st.className='rs err';repoOK=false;}
    }catch{st.textContent='✗ check failed';st.className='rs err';repoOK=false;}
    syncCreate();
  },280);
}
function syncCreate(){
  const nm=$('f_name').value.trim();
  const dup=agents.some(a=>a.name===nm);
  $('f_err').textContent=dup?('agent "'+nm+'" already exists'):'';
  $('createbtn').disabled=!nm||dup||!repoOK;
}
$('f_repo').oninput=checkRepo;
$('f_name').oninput=syncCreate;
$('newform').onsubmit=async ev=>{
  ev.preventDefault();
  const btn=$('createbtn');btn.disabled=true;const lbl=btn.textContent;btn.innerHTML='<span class="spin"></span> creating…';
  const body={name:$('f_name').value.trim(),agent:$('f_agent').value,repo:$('f_repo').value.trim()||'.'};
  const br=$('f_branch').value.trim();if(br)body.branch=br;const ba=$('f_base').value.trim();if(ba)body.base=ba;
  try{
    const r=await postJSON('/api/new',body);const j=await r.json();
    if(!r.ok)throw new Error(j.error||'failed');
    closeModal();$('f_name').value='';beep(CHIME.new);toast('created '+body.name,'ok');await select(body.name);
  }catch(e){$('f_err').textContent=e.message;}
  finally{btn.disabled=false;btn.textContent=lbl;}
};

/* ---- keyboard ---- */
document.addEventListener('keydown',e=>{
  const typing=/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement&&document.activeElement.tagName);
  if(e.key==='Escape'){closeModal();return;}
  if(e.key==='n'&&!typing&&!$('modal').classList.contains('open')){e.preventDefault();openModal();}
});

/* ---- live updates: chimes / notifications / title badge ---- */
function onSnapshot(list){
  list.forEach(a=>{
    const p=prevStatus[a.name];
    if(p&&p!==a.status){
      if(a.status==='waiting'){beep(CHIME.waiting);notify('amux · '+a.name+' needs you',a.note);toast(a.name+' is waiting','warn');}
      else if(a.status==='done'){beep(CHIME.done);notify('amux · '+a.name+' done',a.note);toast(a.name+' done','ok');}
      else if(a.status==='error'){beep(CHIME.error);notify('amux · '+a.name+' error',a.note);toast(a.name+' error','err');}
    }
    prevStatus[a.name]=a.status;
  });
  const w=list.filter(a=>a.status==='waiting').length;
  document.title=(w?'('+w+') ':'')+'amux';
}

async function loadUsage(){
  try{
    const rows=await (await api('/api/usage')).json();
    usage={};let total=0;
    for(const r of rows){usage[r.name]=r;if(r.usageView&&r.usageView.costUSD!=null)total+=r.usageView.costUSD;}
    $('totalcost').textContent=total>0?('total ~$'+total.toFixed(3)):'';
    renderList();
  }catch(e){}
}
async function boot(){
  const keys=await (await api('/api/agent-keys')).json();
  $('f_agent').innerHTML=keys.map(k=>\`<option>\${esc(k)}</option>\`).join('');
  agents=await (await api('/api/agents')).json();
  agents.forEach(a=>prevStatus[a.name]=a.status); // seed, don't chime existing
  renderList();await loadConflicts();onSnapshot(agents);await loadUsage();
  setInterval(loadUsage,6000);
  const ev=new EventSource('/api/events'+Q);
  ev.onopen=()=>$('live').classList.add('live');
  ev.onerror=()=>$('live').classList.remove('live');
  ev.addEventListener('snapshot',e=>{
    agents=JSON.parse(e.data);
    if(selected&&!agents.find(a=>a.name===selected)){selected=null;$('term').style.display='none';$('empty').style.display='flex';}
    loadConflicts();onSnapshot(agents);
  });
  ev.addEventListener('alert',e=>{
    const a=JSON.parse(e.data);beep(CHIME.error);notify('amux alert',a.text);toast(a.text,'err');loadUsage();
  });
}
boot();
</script>
</body>
</html>`;
