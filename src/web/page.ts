// Dashboard page, inlined so there is no asset-copy build step. Vanilla JS:
// fetches /api/agents + /api/conflicts, live-updates over /api/events (SSE).
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>amux</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--bd:#30363d;--fg:#e6edf3;--mut:#8b949e;
        --grn:#3fb950;--ylw:#d29922;--cyn:#39c5cf;--red:#f85149;--gry:#6e7681}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  header{display:flex;align-items:center;gap:12px;padding:14px 20px;
         border-bottom:1px solid var(--bd)}
  header h1{font-size:18px;margin:0;letter-spacing:.5px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--gry)}
  .dot.live{background:var(--grn);box-shadow:0 0 8px var(--grn)}
  main{padding:20px;max-width:1100px;margin:0 auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px}
  .card.warn{border-color:var(--red)}
  .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .name{font-weight:700;font-size:15px}
  .badge{font-size:11px;padding:2px 8px;border-radius:20px;text-transform:uppercase}
  .b-running{background:rgba(63,185,80,.15);color:var(--grn)}
  .b-waiting{background:rgba(210,153,34,.15);color:var(--ylw)}
  .b-done{background:rgba(57,197,207,.15);color:var(--cyn)}
  .b-error{background:rgba(248,81,73,.15);color:var(--red)}
  .b-dead{background:rgba(110,118,129,.15);color:var(--gry)}
  .meta{color:var(--mut);font-size:12px;margin-top:8px;word-break:break-all}
  .note{margin-top:8px;color:var(--fg)}
  .cmd{margin-top:10px;background:#010409;border:1px solid var(--bd);border-radius:6px;
       padding:6px 8px;font-size:12px;color:var(--cyn);cursor:pointer;user-select:all}
  button{background:#21262d;color:var(--fg);border:1px solid var(--bd);border-radius:6px;
         padding:4px 10px;cursor:pointer;font:inherit;font-size:12px}
  button:hover{border-color:var(--mut)}
  .conflicts{margin-top:24px}
  .conflicts h2{font-size:14px;color:var(--red)}
  .cf{background:var(--card);border:1px solid var(--red);border-radius:8px;
      padding:8px 12px;margin-bottom:8px;font-size:13px}
  .cf .who{color:var(--mut);font-size:12px}
  .empty{color:var(--mut);padding:40px;text-align:center}
</style>
</head>
<body>
<header>
  <span class="dot" id="live"></span>
  <h1>amux</h1>
  <span id="count" style="color:var(--mut)"></span>
</header>
<main>
  <div class="grid" id="grid"></div>
  <div class="conflicts" id="cwrap" style="display:none">
    <h2>⚠ merge conflicts</h2>
    <div id="conflicts"></div>
  </div>
</main>
<script>
const TOKEN="__AMUX_TOKEN__";
const AUTH=TOKEN?{'x-amux-token':TOKEN}:{};
const Q=TOKEN?('?token='+encodeURIComponent(TOKEN)):'';
if(TOKEN&&location.search){history.replaceState(null,'',location.pathname);}
function api(p,o){o=o||{};o.headers=Object.assign({},o.headers||{},AUTH);return fetch(p,o);}
const BADGE={running:'b-running',waiting:'b-waiting',done:'b-done',error:'b-error',dead:'b-dead'};
let agents=[];
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function card(a){
  return \`<div class="card \${conflicted.has(a.name)?'warn':''}">
    <div class="row"><span class="name">\${esc(a.name)} \${conflicted.has(a.name)?'⚠':''}</span>
      <span class="badge \${BADGE[a.status]||'b-dead'}">\${a.status}</span></div>
    <div class="meta">\${esc(a.agent)} · \${esc(a.branch)}</div>
    \${a.note?\`<div class="note">\${esc(a.note)}</div>\`:''}
    <div class="cmd" title="click to select">amux attach \${esc(a.name)}</div>
    <div class="row" style="margin-top:10px">
      <button onclick="kill('\${esc(a.name)}',false)">kill</button>
      <button onclick="kill('\${esc(a.name)}',true)">kill + rm</button>
    </div>
  </div>\`;
}
let conflicted=new Set();
function render(){
  document.getElementById('count').textContent=agents.length+' agents';
  const g=document.getElementById('grid');
  g.innerHTML=agents.length?agents.map(card).join(''):'<div class="empty">no agents — amux new &lt;name&gt;</div>';
}
async function loadConflicts(){
  const cs=await (await api('/api/conflicts')).json();
  conflicted=new Set(cs.flatMap(c=>c.agents));
  const wrap=document.getElementById('cwrap');
  wrap.style.display=cs.length?'block':'none';
  document.getElementById('conflicts').innerHTML=cs.map(c=>
    \`<div class="cf">\${esc(c.file)}<div class="who">← \${c.agents.map(esc).join(', ')}</div></div>\`).join('');
  render();
}
async function kill(name,rm){
  await api('/api/kill',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({name,rmWorktree:rm})});
}
async function boot(){
  agents=await (await api('/api/agents')).json();
  await loadConflicts();
  const ev=new EventSource('/api/events'+Q);
  ev.onopen=()=>document.getElementById('live').classList.add('live');
  ev.onerror=()=>document.getElementById('live').classList.remove('live');
  ev.addEventListener('snapshot',e=>{agents=JSON.parse(e.data);loadConflicts();});
}
boot();
</script>
</body>
</html>`;
