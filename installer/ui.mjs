/**
 * Instalador — UI premium (HTML self-contained, dark/light). Servida em localhost.
 * Cadastro + picker de módulos + ENTREVISTA inline (os campos obrigatórios do papel
 * abrem conforme o que foi marcado) + stub de pagamento + treinamento grátis + anel
 * de progresso da instalação.
 */
import { PRODUTOS, TRIAL_DAYS } from './catalog.mjs';
import { SETS } from '../engine/interview/schema.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
:root{--bg:#0b1020;--card:#141a2e;--fg:#e7ebf7;--muted:#93a0bd;--line:#232c46;--accent:#6d5efc;--accent2:#22d3ee;--ok:#22c55e;--warn:#f59e0b;}
@media (prefers-color-scheme:light){:root{--bg:#eef1f8;--card:#fff;--fg:#101528;--muted:#5b6683;--line:#e3e8f3;}}
:root[data-theme=light]{--bg:#eef1f8;--card:#fff;--fg:#101528;--muted:#5b6683;--line:#e3e8f3;}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,rgba(109,94,252,.18),transparent),var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Inter,sans-serif;min-height:100vh}
.wrap{max-width:920px;margin:0 auto;padding:36px 20px 60px}
.brand{font-size:26px;font-weight:850;letter-spacing:-.02em}.brand b{background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--muted);margin-top:4px}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px}
.badge{background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;font-weight:700;font-size:12px;padding:6px 12px;border-radius:999px;white-space:nowrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin-bottom:16px;box-shadow:0 10px 30px rgba(0,0,0,.15)}
.card h2{margin:0 0 4px;font-size:15px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input[type=text],input[type=email],input[type=number],textarea,select{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--fg);font-size:14px;font-family:inherit}
textarea{min-height:64px;resize:vertical}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent)}
.req{color:var(--warn)}
.prod{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;margin-top:10px;cursor:pointer;transition:.15s}
.prod:hover{border-color:var(--accent)}.prod.soon{opacity:.55;cursor:not-allowed}
.prod input{margin-top:3px;width:18px;height:18px;accent-color:var(--accent)}
.prod .n{font-weight:700}.prod .d{color:var(--muted);font-size:13px}
.tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px}
.tag.dev{background:rgba(109,94,252,.18);color:var(--accent)}.tag.vendas{background:rgba(34,211,238,.16);color:var(--accent2)}.tag.soon{background:rgba(245,158,11,.16);color:var(--warn)}.tag.suporte{background:rgba(148,160,189,.18);color:var(--muted)}
.setgrp{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:12px}
.setgrp h3{margin:0 0 2px;font-size:13px;color:var(--accent)}
.chk{display:inline-flex;gap:6px;align-items:center;margin:4px 10px 4px 0;font-size:14px;color:var(--fg)}
.hint{color:var(--muted);font-size:12px;margin-top:2px}
.train{background:linear-gradient(90deg,rgba(34,197,94,.16),rgba(34,211,238,.10));border:1px solid rgba(34,197,94,.35)}.train h2{color:var(--ok)}
.stub{border-style:dashed}
.btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:none;padding:14px 22px;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;width:100%;justify-content:center}
.btn:disabled{opacity:.5;cursor:not-allowed}
.muted{color:var(--muted);font-size:13px}
.result{white-space:pre-wrap;background:rgba(0,0,0,.2);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;display:none}.result.show{display:block}
/* overlay + anel de progresso */
.overlay{position:fixed;inset:0;background:rgba(6,9,18,.86);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;flex-direction:column;z-index:9}
.overlay.show{display:flex}
.ring{transform:rotate(-90deg)}
.ring .track{stroke:var(--line)}.ring .bar{stroke:url(#g);stroke-linecap:round;transition:stroke-dashoffset .35s ease}
.pct{font-size:34px;font-weight:850}.stage{color:var(--muted);margin-top:10px}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:18px}
`;

function renderField(setId, q) {
  const name = `${setId}.${q.id}`;
  const req = q.required ? '<span class="req">*</span>' : '';
  const help = q.help ? `<div class="hint">${esc(q.help)}</div>` : '';
  let field;
  if (q.tipo === 'longtext' || q.tipo === 'list') {
    field = `<textarea data-set="${setId}" data-id="${q.id}" data-tipo="${q.tipo}" ${q.required ? 'data-req="1"' : ''} placeholder="${q.tipo === 'list' ? 'um por linha' : ''}"></textarea>`;
  } else if (q.tipo === 'number') {
    field = `<input type="number" step="any" data-set="${setId}" data-id="${q.id}" data-tipo="number" ${q.required ? 'data-req="1"' : ''}>`;
  } else if (q.tipo === 'choice') {
    field = `<select data-set="${setId}" data-id="${q.id}" data-tipo="choice" ${q.required ? 'data-req="1"' : ''}><option value="">Selecione…</option>${q.opcoes.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  } else if (q.tipo === 'multichoice') {
    field = `<div data-set="${setId}" data-id="${q.id}" data-tipo="multichoice" ${q.required ? 'data-req="1"' : ''}>${q.opcoes.map((o) => `<label class="chk"><input type="checkbox" value="${esc(o)}">${esc(o)}</label>`).join('')}</div>`;
  } else {
    field = `<input type="text" data-set="${setId}" data-id="${q.id}" data-tipo="text" ${q.required ? 'data-req="1"' : ''}>`;
  }
  return `<label>${esc(q.pergunta)} ${req}</label>${field}${help}`;
}

function renderSetGroup(setId) {
  const nomes = { empresa: 'Empresa', vendas: 'Vendas + Marketing', dev: 'Dev — padrão de branch/commit/doc', analista: 'Analista — acesso ao tracker', qa: 'QA — acesso à doc de testes' };
  return `<div class="setgrp" data-setgrp="${setId}" style="display:none">
    <h3>${esc(nomes[setId] || setId)}</h3>
    ${SETS[setId].map((q) => renderField(setId, q)).join('')}
  </div>`;
}

export function renderInstaller() {
  const prods = PRODUTOS.map((p) => {
    const soon = p.status !== 'available';
    return `<label class="prod ${soon ? 'soon' : ''}">
      <input type="checkbox" class="prodchk" value="${p.id}" ${soon ? 'disabled' : 'checked'}>
      <span><span class="n">${esc(p.nome)}<span class="tag ${soon ? 'soon' : p.linha}">${soon ? 'em breve' : p.linha}</span></span>
      <div class="d">${esc(p.desc)}</div></span></label>`;
  }).join('');
  const grupos = Object.keys(SETS).map(renderSetGroup).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Instalar VelosoSolution</title><style>${CSS}</style></head><body>
<div class="wrap">
  <div class="hero"><div><div class="brand">Veloso<b>Solution</b></div><div class="sub">Instalador — automação com IA pro seu time</div></div>
    <span class="badge">Teste grátis · ${TRIAL_DAYS} dias</span></div>

  <form id="f">
    <div class="card"><h2>1 · Seus dados</h2>
      <div class="row"><div><label>Nome</label><input type="text" name="nome" required></div>
      <div><label>Empresa</label><input type="text" name="empresa"></div></div>
      <label>E-mail (recebe a chave do teste)</label><input type="email" name="email" required></div>

    <div class="card"><h2>2 · Escolha os produtos</h2>
      <p class="muted">Marque o que quer instalar — os campos obrigatórios de cada um abrem abaixo.</p>
      ${prods}</div>

    <div class="card"><h2>3 · Configuração (entrevista)</h2>
      <p class="muted" id="cfghint">Marque um produto pra abrir os campos.</p>
      ${grupos}</div>

    <div class="card stub"><h2>4 · Pagamento</h2>
      <p class="muted">Stub — Stripe entra aqui. No teste de ${TRIAL_DAYS} dias você não paga nada agora.</p></div>

    <div class="card train"><h2>🎓 Treinamento grátis</h2>
      <p>Todo cliente tem <b>treinamento gratuito</b>. <b>Recomendamos fortemente</b> fazer antes de começar — fala com a gente pra agendar.</p></div>

    <button class="btn" id="go" type="submit">Instalar na minha máquina →</button>
    <div class="muted" style="margin-top:8px">Detectamos sua IDE / IA (Claude Code, Cursor, Windsurf…) e instalamos o MCP no lugar certo.</div>
    <div class="result" id="r"></div>
  </form>
  <div class="foot">VelosoSolution · a suite adota o padrão da sua empresa — nada de default.</div>
</div>

<div class="overlay" id="ov">
  <svg width="180" height="180" viewBox="0 0 180 180" class="ring">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5efc"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    <circle class="track" cx="90" cy="90" r="78" fill="none" stroke-width="12"/>
    <circle class="bar" id="bar" cx="90" cy="90" r="78" fill="none" stroke-width="12" stroke-dasharray="490" stroke-dashoffset="490"/>
  </svg>
  <div class="pct" id="pct" style="position:absolute">0%</div>
  <div class="stage" id="stage">preparando…</div>
</div>

<script>
const SETS=${JSON.stringify(SETS)};
const DEV_FLOW=['gate','vsqa','vsanalista','vsdiretoria'];
const f=document.getElementById('f'),r=document.getElementById('r'),go=document.getElementById('go');
const ov=document.getElementById('ov'),bar=document.getElementById('bar'),pct=document.getElementById('pct'),stage=document.getElementById('stage');
const C=490;

function activeSets(){const ids=[...f.querySelectorAll('.prodchk:checked')].map(x=>x.value);const s=new Set();
  if(ids.some(i=>DEV_FLOW.includes(i))){['empresa','dev','analista','qa'].forEach(x=>s.add(x));}
  if(ids.includes('vsvendas')){s.add('empresa');s.add('vendas');}return s;}
function refresh(){const s=activeSets();let any=false;
  document.querySelectorAll('[data-setgrp]').forEach(g=>{const on=s.has(g.dataset.setgrp);g.style.display=on?'block':'none';if(on)any=true;});
  document.getElementById('cfghint').style.display=any?'none':'block';}
f.querySelectorAll('.prodchk').forEach(c=>c.addEventListener('change',refresh));refresh();

function collect(){const s=activeSets();const respostas={};let faltou=null;
  document.querySelectorAll('[data-setgrp]').forEach(g=>{const set=g.dataset.setgrp;if(!s.has(set))return;respostas[set]={};
    g.querySelectorAll('[data-id]').forEach(el=>{const id=el.dataset.id,tipo=el.dataset.tipo;let v;
      if(tipo==='multichoice'){v=[...el.querySelectorAll('input:checked')].map(x=>x.value);}
      else{v=(el.value||'').trim();}
      const empty=(tipo==='multichoice')?v.length===0:v==='';
      if(!empty)respostas[set][id]=v;
      if(el.dataset.req&&empty&&!faltou)faltou=set+': '+(el.previousElementSibling?el.previousElementSibling.textContent:id);});});
  return {respostas,faltou};}

function setPct(p){const off=C-(C*p/100);bar.setAttribute('stroke-dashoffset',off);pct.textContent=Math.round(p)+'%';}
let timer=null;
function animateTo(target,ms){clearInterval(timer);const start=parseFloat(pct.textContent)||0;const t0=Date.now();
  timer=setInterval(()=>{const k=Math.min(1,(Date.now()-t0)/ms);setPct(start+(target-start)*k);if(k>=1)clearInterval(timer);},40);}

f.addEventListener('submit',async(e)=>{e.preventDefault();
  const {respostas,faltou}=collect();
  if(faltou){r.className='result show';r.textContent='⚠ Preencha os campos obrigatórios — '+faltou;return;}
  const fd=new FormData(f);const produtos=[...f.querySelectorAll('.prodchk:checked')].map(x=>x.value);
  ov.classList.add('show');setPct(0);
  const stages=['validando dados','emitindo chave de 7 dias','detectando sua IDE','instalando o MCP'];
  let si=0;stage.textContent=stages[0];animateTo(85,2600);
  const rot=setInterval(()=>{si=(si+1)%stages.length;stage.textContent=stages[si];},700);
  try{
    const resp=await fetch('/install',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nome:fd.get('nome'),empresa:fd.get('empresa'),email:fd.get('email'),produtos,respostas})});
    const d=await resp.json();clearInterval(rot);
    if(!d.ok){animateTo(0,300);setTimeout(()=>{ov.classList.remove('show');r.className='result show';r.textContent='⚠ '+(d.erros||['falha']).join('\\n');},400);return;}
    stage.textContent='concluído';animateTo(100,500);
    let out='✅ Instalado!\\n\\nProdutos: '+d.escolhidos.join(', ')+'\\n';
    out+=d.trial.token?('Chave de teste ('+d.trial.days+' dias):\\n'+d.trial.token+'\\n'):('Teste de '+d.trial.days+' dias: '+d.trial.reason+' (chave vai no seu e-mail).\\n');
    out+='\\n'+(d.semFerramenta?'Nenhuma IDE/IA detectada — te mando o passo manual.':'MCP instalado em:\\n'+d.configurados.map(c=>' • '+c.tool+(c.erro?(' (erro)'):(' → '+c.path))).join('\\n'));
    out+='\\n\\n🎓 '+d.treinamento.mensagem;
    setTimeout(()=>{ov.classList.remove('show');r.className='result show';r.textContent=out;go.textContent='Concluído ✓';go.disabled=true;},700);
  }catch(err){clearInterval(rot);ov.classList.remove('show');r.className='result show';r.textContent='✖ '+err.message;}
});
</script>
</body></html>`;
}
