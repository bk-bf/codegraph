import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { listProjects, loadGraph } from '$lib/server/data';
import { GROUP_COLORS } from '$lib/graph/colors';

// Self-contained, offline, read-only HTML snapshot of a project's layered graph.
// Inlines the graph JSON + vendored Mermaid + a compact viewer — a single file
// you can open via file:// or share. (The live SvelteKit app is the full tool.)
export const GET: RequestHandler = ({ url }) => {
  const project = url.searchParams.get('project') ?? listProjects()[0];
  const graph = project ? loadGraph(project) : null;
  if (!graph) return new Response('no graph', { status: 503 });

  const mermaidSrc = fs.readFileSync(path.resolve(process.cwd(), 'vendor/mermaid.min.js'), 'utf8');
  const safe = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');
  const html = page(safe(graph), safe(GROUP_COLORS), mermaidSrc, graph.project ?? project!, graph.stats);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="codegraph-${project}.html"`
    }
  });
};

function page(graphJson: string, colorsJson: string, mermaidSrc: string, name: string, stats: { functions: number; edges: number; modules: number }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>codegraph — ${name}</title>
<style>
  :root{--bg:#0d1117;--fg:#d7dce3;--dim:#8b94a3;--border:#2a313c;--accent:#f5a623}
  *{box-sizing:border-box}html,body{height:100%;margin:0}
  body{background:var(--bg);color:var(--fg);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;overflow:hidden}
  header{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border)}
  header strong{color:var(--accent);letter-spacing:1px}.dim{color:var(--dim)}
  #stage{position:absolute;inset:44px 0 0 0;overflow:hidden;cursor:grab}#stage:active{cursor:grabbing}
  #vp{position:absolute;top:20px;left:50%;transform-origin:top center;will-change:transform}
  #vp g.node{cursor:default}
  #vp svg.focus g.node:not(.hot){opacity:.18}#vp svg.focus g.edgePaths path:not(.hot){opacity:.07}
  #vp path.hot{stroke:#57c7ff!important;stroke-width:2.5px!important}
  #tip{position:absolute;bottom:12px;right:12px;background:#1c232d;border:1px solid var(--border);border-radius:4px;padding:4px 10px}
</style></head><body>
<header><strong>codegraph</strong><span>${name}</span><span class="dim">·</span>
<span class="dim">${stats.functions} fns · ${stats.edges} calls · ${stats.modules} modules · offline snapshot</span></header>
<div id="stage"><div id="vp">rendering…</div><div id="tip" class="dim">hover a module</div></div>
<script>${mermaidSrc}</script>
<script type="application/json" id="g">${graphJson}</script>
<script>
const G=JSON.parse(document.getElementById('g').textContent);
const COL=${colorsJson};const gc=g=>COL[g]||'#8b94a3';
const pref=(G.config&&G.config.namespacePrefix)||null;
const esc=s=>String(s).replace(/["#;{}]/g,' ').replace(/\\s+/g,' ').trim();
function shade(h){h=h.replace('#','');const p=i=>Math.round(parseInt(h.slice(i,i+2),16)*.28).toString(16).padStart(2,'0');return '#'+p(0)+p(2)+p(4)}
function build(){const grp={};for(const m of G.moduleNodes)(grp[m.group]||(grp[m.group]=[])).push(m);
 let src='flowchart TB\\n';const id=new Map();let i=0;for(const m of G.moduleNodes)id.set(m.module,'m'+i++);const st=[];
 for(const k in grp){src+='subgraph G_'+k+'["'+k.toUpperCase()+'"]\\n';for(const m of grp[k]){const s=id.get(m.module);
  src+='  '+s+'["'+esc(m.module.split('/').pop())+'<br/>'+m.fns+' fn"]\\n';st.push('style '+s+' fill:'+shade(gc(k))+',stroke:'+gc(k)+',color:#e6edf3')}src+='end\\n'}
 const el=[];for(const e of G.moduleEdges){const a=id.get(e.from),b=id.get(e.to);if(!a||!b)continue;src+=a+(e.count>=6?' ==> ':' --> ')+b+'\\n';el.push({from:e.from,to:e.to})}
 src+=st.join('\\n')+'\\n';return{src,id,el}}
mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'loose',flowchart:{useMaxWidth:false,htmlLabels:false,curve:'basis',nodeSpacing:45,rankSpacing:70},themeVariables:{fontFamily:'JetBrains Mono,monospace',fontSize:'13px',lineColor:'#5b6675',mainBkg:'#1c232d',clusterBkg:'#13181f',clusterBorder:'#2a313c'}});
const tip=document.getElementById('tip');
(async()=>{const b=build();const{svg}=await mermaid.render('mmd',b.src);const vp=document.getElementById('vp');vp.innerHTML=svg;
 const rev=new Map([...b.id.entries()].map(([g,s])=>[s,g]));const byGid=new Map();const el=vp.querySelector('svg');el.removeAttribute('width');el.removeAttribute('height');
 const paths=[...el.querySelectorAll('g.edgePaths>path')];
 el.querySelectorAll('g.node').forEach(g=>{const m=/flowchart-(m\\d+)-/.exec(g.id)||/(m\\d+)/.exec(g.id);const gid=m&&rev.get(m[1]);if(!gid)return;byGid.set(gid,g);
  g.addEventListener('mouseenter',()=>{el.classList.add('focus');g.classList.add('hot');tip.textContent=pref&&gid.startsWith(pref+'/')?gid.slice(pref.length+1):gid;
   b.el.forEach((e,i)=>{if(e.from===gid||e.to===gid){paths[i]&&paths[i].classList.add('hot');const o=byGid.get(e.from===gid?e.to:e.from);o&&o.classList.add('hot')}})});
  g.addEventListener('mouseleave',()=>{el.classList.remove('focus');el.querySelectorAll('.hot').forEach(x=>x.classList.remove('hot'));tip.textContent='hover a module'})});
})();
let pz={x:0,y:0,k:.85},drag=null;const st=document.getElementById('stage'),vp=document.getElementById('vp');
const apply=()=>vp.style.transform='translate('+pz.x+'px,'+pz.y+'px) scale('+pz.k+')';apply();
st.addEventListener('mousedown',e=>{if(e.target.closest('.node')||e.target.closest('path'))return;drag={x:e.clientX,y:e.clientY,ox:pz.x,oy:pz.y}});
addEventListener('mousemove',e=>{if(!drag)return;pz.x=drag.ox+(e.clientX-drag.x);pz.y=drag.oy+(e.clientY-drag.y);apply()});
addEventListener('mouseup',()=>drag=null);
st.addEventListener('wheel',e=>{e.preventDefault();pz.k=Math.max(.15,Math.min(3,pz.k*(e.deltaY<0?1.1:.9)));apply()},{passive:false});
</script></body></html>`;
}
