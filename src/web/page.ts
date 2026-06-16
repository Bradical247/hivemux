// cmux-style GUI: sidebar of agent workspaces (status/notification rings) + a
// main pane with the selected agent's live terminal (embedded ttyd iframe) and a
// toolbar. Next-level create flow (live repo validation, repo picker, advanced
// options, real creating-state) plus sound chimes, desktop notifications,
// keyboard shortcuts, toasts, and a waiting-count title badge. Live over SSE.
// `"__HIVEMUX_TOKEN__"` is replaced server-side with the auth token (or "").
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>hivemux</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate icon" href="/favicon.ico" sizes="any" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0d1117" />
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
  button svg.ic{width:13px;height:13px;vertical-align:-2px;margin-right:5px;
       stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  button svg.ic .fill{fill:currentColor;stroke:none}
  .top button{display:inline-flex;align-items:center}
  input,select{background:#010409;color:var(--fg);border:1px solid var(--bd);border-radius:6px;
       padding:7px 9px;font:inherit;font-size:13px;width:100%}

  .side{width:264px;min-width:264px;background:#0b0e13;border-right:1px solid var(--bd);display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--bd);font-weight:700;font-size:16px}
  .brand .dot{width:11px;height:11px;background:var(--gry);
        clip-path:polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)}
  .brand .dot.live{background:var(--grn);box-shadow:0 0 8px var(--grn)}
  .brand .sp{flex:1}
  .brand .snd{background:none;border:0;font-size:15px;padding:2px 4px}
  .side .new{margin:12px}
  .list{flex:1;overflow:auto;padding:0 8px}
  .ws{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;margin-bottom:4px}
  .ws:hover{background:#11161d}
  .ws.sel{background:var(--sel);outline:1px solid var(--bd)}
  /* honeycomb-cell status marks (flat-top hexagon) */
  .ring{width:12px;height:12px;flex:none;background:var(--gry);
        clip-path:polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)}
  .ring.running{background:var(--grn)}
  .ring.waiting{background:var(--ylw);animation:pulse 1.4s infinite}
  .ring.done{background:var(--cyn)}
  .ring.error{background:var(--red);animation:pulse 1.4s infinite}
  .ring.dead{background:var(--gry)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
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
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .checks{display:flex;gap:16px;font-size:12px;color:var(--mut)}
  .checks label{display:flex;align-items:center;gap:6px;cursor:pointer}
  .checks input{width:auto}
  .code{background:#010409;border:1px solid var(--bd);border-radius:6px;padding:8px 10px;font-size:12px;white-space:pre-wrap;word-break:break-all;color:var(--cyn)}
  .tool{padding:7px 0;border-bottom:1px solid var(--bd)}
  .tool .tn{color:var(--grn);font-weight:600}
  .tool .td{color:var(--mut);font-size:11px;margin-top:2px}
  .logrow{padding:6px 0;border-bottom:1px solid var(--bd)}
  .logrow .li{color:var(--ylw)} .logrow .lp{color:var(--grn)} .logrow .lf{color:var(--red)}
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
  <div class="brand"><span class="dot" id="live"></span> hivemux <span id="count" style="color:var(--mut);font-weight:400;font-size:12px"></span>
    <span class="sp"></span><button class="snd" id="snd" title="sound on/off">sound</button></div>
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
    <button id="loopbtn">loop</button>
    <button id="mergebtn">merge</button>
    <button id="prbtn">PR</button>
    <button id="killbtn">kill</button>
    <span style="width:1px;height:20px;background:var(--bd);margin:0 2px"></span>
    <button id="fleetbtn" title="run one goal across N fresh agents">fleet</button>
    <button id="mcpbtn" title="drive hivemux from an MCP client">MCP</button>
    <button id="prunebtn" title="remove agents whose tmux session is gone">prune</button>
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
      <div class="field"><label>branch</label><input id="f_branch" placeholder="hivemux/<name>" autocomplete="off" /></div>
      <div class="field"><label>base ref</label><input id="f_base" placeholder="(default)" autocomplete="off" /></div>
    </div>
    <div class="ferr" id="f_err"></div>
    <div class="row2"><button type="button" id="cancel">cancel</button><button type="submit" id="createbtn">create</button></div>
  </form>
</div>
<div class="modal" id="loopmodal">
  <form class="sheet" id="loopform">
    <h3 id="loophdr">loop</h3>
    <div class="field"><label>goal</label><input id="l_goal" placeholder="make the failing test pass" autocomplete="off" required /></div>
    <div class="field"><label>verifier</label>
      <select id="l_vtype"><option value="check">shell check (exit 0 = pass)</option><option value="rubric">LLM judge (rubric)</option></select>
    </div>
    <div class="field" id="l_checkfield"><label>shell check</label><input id="l_check" placeholder="bun test" autocomplete="off" /></div>
    <div class="field" id="l_rubricfield" style="display:none"><label>rubric</label><input id="l_rubric" placeholder="all tests pass and lint is clean" autocomplete="off" /></div>
    <div class="grid2">
      <div class="field"><label>max iterations</label><input id="l_max" type="number" min="1" value="10" /></div>
      <div class="field"><label>runner</label><select id="l_runner"></select></div>
    </div>
    <div class="field" id="l_fleetfield" style="display:none">
      <div class="grid2">
        <div><label>fleet size</label><input id="l_fleet" type="number" min="2" value="3" /></div>
        <div><label>repo</label><input id="l_repo" value="." autocomplete="off" /></div>
      </div>
    </div>
    <div class="checks">
      <label><input type="checkbox" id="l_commit" /> commit on pass</label>
      <label><input type="checkbox" id="l_pr" /> open PR on pass</label>
    </div>
    <div class="ferr" id="l_err"></div>
    <div class="row2"><button type="button" id="l_cancel">cancel</button><button type="submit" id="l_start">start</button></div>
  </form>
</div>

<div class="modal" id="logmodal">
  <div class="sheet" style="width:560px">
    <h3 id="loghdr">loop history</h3>
    <div id="logbody" style="max-height:60vh;overflow:auto;font-size:12px"></div>
    <div class="row2"><button type="button" id="log_close">close</button></div>
  </div>
</div>

<div class="modal" id="mcpmodal">
  <div class="sheet" style="width:620px">
    <h3>MCP server</h3>
    <p style="margin:0;color:var(--mut);font-size:12px">Drive a hivemux fleet from any MCP client (Claude Code, Claude Desktop, Cursor). A conductor agent spawns workers, starts verify-fix loops, watches status, and merges the passes.</p>
    <div class="field"><label>command</label><div class="code" id="mcp_cmd">hivemux mcp</div></div>
    <div class="field"><label>client config (claude_desktop_config.json / .mcp.json)</label>
      <div class="code" id="mcp_cfg"></div>
      <button type="button" id="mcp_copy" style="margin-top:6px">copy config</button>
    </div>
    <div class="field"><label>tools (<span id="mcp_count"></span>)</label><div id="mcp_tools" style="max-height:34vh;overflow:auto"></div></div>
    <div class="row2"><button type="button" id="mcp_close">close</button></div>
  </div>
</div>
<div class="toasts" id="toasts"></div>

<script>
const TOKEN="__HIVEMUX_TOKEN__";
const AUTH=TOKEN?{'x-hivemux-token':TOKEN}:{};
const Q=TOKEN?('?token='+encodeURIComponent(TOKEN)):'';
if(TOKEN&&location.search){history.replaceState(null,'',location.pathname);}
function api(p,o){o=o||{};o.headers=Object.assign({},o.headers||{},AUTH);return fetch(p,o);}
function postJSON(p,b){return api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
const $=id=>document.getElementById(id);

/* ---- brand icon set (hive-forward, inline SVG, currentColor) ---- */
const SVG=p=>'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">'+p+'</svg>';
const HEX='M8 1.4l5.7 3.3v6.6L8 14.6 2.3 11.3V4.7Z';
const ICON={
  send:SVG('<path d="M2 8h9"/><path d="M8 4l4 4-4 4"/>'),              // broadcast → arrow
  loop:SVG('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.6V5h-2.4"/>'), // refresh
  fleet:SVG('<path d="M5 2.6l2.3 1.3v2.6L5 7.8 2.7 6.5V3.9Z" class="fill"/><path d="M11 2.6l2.3 1.3v2.6L11 7.8 8.7 6.5V3.9Z"/><path d="M8 8.2l2.3 1.3v2.6L8 13.4l-2.3-1.3V9.5Z"/>'),
  mcp:SVG('<path d="'+HEX+'"/><circle cx="8" cy="8" r="1.5" class="fill"/>'),  // hive node
  merge:SVG('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="6" r="1.5"/><path d="M4.5 5v6"/><path d="M4.5 8.5a4 4 0 0 0 4-2"/>'),
  pr:SVG('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6"/><path d="M11.5 11V7a3 3 0 0 0-3-3H7"/>'),
  kill:SVG('<path d="M4.5 4.5l7 7"/><path d="M11.5 4.5l-7 7"/>'),
  prune:SVG('<circle cx="4" cy="11" r="1.6"/><circle cx="4" cy="5" r="1.6"/><path d="M5.4 9.9L12 4"/><path d="M5.4 6.1L12 12"/>'), // scissors
  add:SVG('<path d="'+HEX+'"/><path d="M8 5.5v5M5.5 8h5"/>'),          // + in hex
};

// decorate the toolbar buttons with their brand glyphs
[['bcastbtn','send','send'],['loopbtn','loop','loop'],['mergebtn','merge','merge'],
 ['prbtn','pr','PR'],['killbtn','kill','kill'],['fleetbtn','fleet','fleet'],
 ['mcpbtn','mcp','MCP'],['prunebtn','prune','prune']].forEach(([id,ic,lbl])=>{
  const b=$(id);if(b)b.innerHTML=ICON[ic]+lbl;
});
$('newbtn').innerHTML=ICON.add+'new agent <span style="color:var(--mut)">(n)</span>';

let agents=[],selected=null,conflicted=new Set(),prevStatus={},usage={};

/* ---- sound + notifications ---- */
let SOUND=localStorage.getItem('hivemux_sound')!=='off';
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
$('snd').onclick=()=>{SOUND=!SOUND;localStorage.setItem('hivemux_sound',SOUND?'on':'off');$('snd').textContent=SOUND?'sound':'muted';$('snd').style.opacity=SOUND?'1':'.5';if(SOUND){arm();beep(CHIME.new);}};
$('snd').textContent=SOUND?'sound':'muted';
$('snd').style.opacity=SOUND?'1':'.5';

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
        \${a.loop?\`<div class="sub" style="color:var(--ylw);cursor:pointer" onclick="event.stopPropagation();openLog('\${esc(a.name)}')" title="loop history">loop \${a.loop.iter}/\${a.loop.maxIters} [\${esc(a.loop.state)}] · log</div>\`:''}
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
/* ---- loop / fleet modal ---- */
let fleetMode=false;
function openLoop(fleet){
  fleetMode=fleet;
  if(!fleet&&!selected){toast('select an agent first','warn');return;}
  const a=agents.find(x=>x.name===selected);
  if(!fleet&&a&&a.loop&&a.loop.state==='running'){postJSON('/api/loop/stop',{name:selected});toast('stopping loop '+selected,'warn');return;}
  $('loophdr').textContent=fleet?'fleet loop':('loop · '+(selected||''));
  $('l_fleetfield').style.display=fleet?'block':'none';
  $('l_err').textContent='';
  $('loopmodal').classList.add('open');$('l_goal').focus();
}
$('loopbtn').onclick=()=>openLoop(false);
$('fleetbtn').onclick=()=>openLoop(true);
$('l_cancel').onclick=()=>$('loopmodal').classList.remove('open');
$('loopmodal').onclick=e=>{if(e.target===$('loopmodal'))$('loopmodal').classList.remove('open');};
$('l_vtype').onchange=()=>{const r=$('l_vtype').value==='rubric';$('l_checkfield').style.display=r?'none':'block';$('l_rubricfield').style.display=r?'block':'none';};
$('loopform').onsubmit=async ev=>{
  ev.preventDefault();
  const goal=$('l_goal').value.trim();if(!goal)return;
  const body={goal,max:Number($('l_max').value)||10,runner:$('l_runner').value||undefined,
    commit:$('l_commit').checked,pr:$('l_pr').checked};
  if($('l_vtype').value==='rubric')body.rubric=$('l_rubric').value.trim()||undefined;
  else body.check=$('l_check').value.trim()||undefined;
  if(fleetMode){body.name='fleet-'+Date.now().toString(36);body.fleet=Number($('l_fleet').value)||3;body.repo=$('l_repo').value.trim()||'.';}
  else body.name=selected;
  const r=await postJSON('/api/loop/start',body);const j=await r.json();
  $('loopmodal').classList.remove('open');
  toast(fleetMode?('fleet started: '+(j.started||[]).join(', ')):('loop started on '+selected),'ok');
};

/* ---- loop history viewer ---- */
async function openLog(name){
  $('loghdr').textContent='loop history · '+name;
  $('logbody').innerHTML='<div style="color:var(--mut)">loading…</div>';
  $('logmodal').classList.add('open');
  const hist=await (await api('/api/loop/log?name='+encodeURIComponent(name))).json();
  if(!hist.length){$('logbody').innerHTML='<div style="color:var(--mut)">no history yet</div>';return;}
  $('logbody').innerHTML=hist.map(h=>{
    const pass=h.passed===true,fail=h.passed===false;
    const cls=pass?'lp':fail?'lf':'li';
    const it=h.iter!=null?('iter '+h.iter):(h.event||'');
    const cost=h.costUSD!=null?(' · $'+Number(h.costUSD).toFixed(3)):'';
    const verdict=pass?' · PASS':fail?' · fail':'';
    return \`<div class="logrow"><span class="\${cls}">\${esc(it)}\${verdict}\${cost}</span>\${h.note?'<div style="color:var(--mut)">'+esc(String(h.note))+'</div>':''}</div>\`;
  }).join('');
}
$('log_close').onclick=()=>$('logmodal').classList.remove('open');
$('logmodal').onclick=e=>{if(e.target===$('logmodal'))$('logmodal').classList.remove('open');};

/* ---- MCP panel ---- */
$('mcpbtn').onclick=async()=>{
  const m=await (await api('/api/mcp')).json();
  const cfg=JSON.stringify({mcpServers:{hivemux:{command:'hivemux',args:['mcp']}}},null,2);
  $('mcp_cfg').textContent=cfg;
  $('mcp_count').textContent=(m.tools||[]).length+' · v'+m.version;
  $('mcp_tools').innerHTML=(m.tools||[]).map(t=>\`<div class="tool"><span class="tn">\${esc(t.name)}</span><div class="td">\${esc(t.description)}</div></div>\`).join('');
  $('mcp_copy').onclick=()=>{navigator.clipboard.writeText(cfg).then(()=>toast('config copied','ok'),()=>toast('copy failed','err'));};
  $('mcpmodal').classList.add('open');
};
$('mcp_close').onclick=()=>$('mcpmodal').classList.remove('open');
$('mcpmodal').onclick=e=>{if(e.target===$('mcpmodal'))$('mcpmodal').classList.remove('open');};

/* ---- prune ---- */
$('prunebtn').onclick=async()=>{
  const r=await postJSON('/api/prune',{rmWorktree:false});const j=await r.json();
  toast(j.pruned&&j.pruned.length?('pruned '+j.pruned.join(', ')):'nothing to prune',j.pruned&&j.pruned.length?'ok':'info');
};

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
      if(a.status==='waiting'){beep(CHIME.waiting);notify('hivemux · '+a.name+' needs you',a.note);toast(a.name+' is waiting','warn');}
      else if(a.status==='done'){beep(CHIME.done);notify('hivemux · '+a.name+' done',a.note);toast(a.name+' done','ok');}
      else if(a.status==='error'){beep(CHIME.error);notify('hivemux · '+a.name+' error',a.note);toast(a.name+' error','err');}
    }
    prevStatus[a.name]=a.status;
  });
  const w=list.filter(a=>a.status==='waiting').length;
  document.title=(w?'('+w+') ':'')+'hivemux';
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
  $('l_runner').innerHTML=['claude',...keys.filter(k=>k!=='claude')].map(k=>\`<option>\${esc(k)}</option>\`).join('');
  agents=await (await api('/api/agents')).json();
  agents.forEach(a=>prevStatus[a.name]=a.status); // seed, don't chime existing
  renderList();await loadConflicts();onSnapshot(agents);await loadUsage();
  if(agents.length&&!selected)select(agents[0].name); // open the first workspace by default
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
    const a=JSON.parse(e.data);beep(CHIME.error);notify('hivemux alert',a.text);toast(a.text,'err');loadUsage();
  });
}
boot();
</script>
</body>
</html>`;
