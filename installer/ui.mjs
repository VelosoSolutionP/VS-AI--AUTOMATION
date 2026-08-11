/**
 * Instalador — UI premium (HTML self-contained, dark/light).
 * Produtos com CHAVE (toggle switch), entrevista em ACCORDION que só abre o que o
 * produto marcado exige, chips no lugar de checkbox, paleta violeta→magenta.
 */
import { PRODUTOS, TRIAL_DAYS, whatsappLink } from './catalog.mjs';
import { SETS } from '../engine/interview/schema.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
:root{--bg:#0c0a14;--card:#171426;--fg:#efe9fb;--muted:#a99fc4;--line:#2a2440;--accent:#8b5cf6;--accent2:#ec4899;--ok:#10b981;--warn:#f59e0b;}
@media (prefers-color-scheme:light){:root{--bg:#f5f2fb;--card:#fff;--fg:#1a1330;--muted:#6b6486;--line:#e9e3f5;}}
:root[data-theme=light]{--bg:#f5f2fb;--card:#fff;--fg:#1a1330;--muted:#6b6486;--line:#e9e3f5;}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1100px 560px at 15% -10%,rgba(139,92,246,.22),transparent),radial-gradient(900px 500px at 95% 0%,rgba(236,72,153,.14),transparent),var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Inter,sans-serif;min-height:100vh}
.wrap{max-width:920px;margin:0 auto;padding:36px 20px 60px}
.brand{font-size:26px;font-weight:850;letter-spacing:-.02em}.brand b{background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--muted);margin-top:4px}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px}
.badge{background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;font-weight:700;font-size:12px;padding:6px 12px;border-radius:999px;white-space:nowrap;box-shadow:0 6px 18px rgba(236,72,153,.3)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin-bottom:16px;box-shadow:0 12px 34px rgba(0,0,0,.22)}
.card h2{margin:0 0 4px;font-size:15px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label.fl{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input[type=text],input[type=email],input[type=number],textarea,select{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--fg);font-size:14px;font-family:inherit}
textarea{min-height:60px;resize:vertical}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(139,92,246,.18)}
.req{color:var(--accent2)}
/* produto + CHAVE */
.prod{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:14px 16px;border:1px solid var(--line);border-radius:14px;margin-top:10px;transition:.15s}
.prod:hover{border-color:var(--accent)}
.prod.on{border-color:var(--accent);background:linear-gradient(90deg,rgba(139,92,246,.10),transparent)}
.prod.soon{opacity:.5}
.prod .n{font-weight:700}.prod .d{color:var(--muted);font-size:13px;margin-top:2px}
.tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px}
.tag.dev{background:rgba(139,92,246,.2);color:var(--accent)}.tag.vendas{background:rgba(236,72,153,.16);color:var(--accent2)}.tag.soon{background:rgba(245,158,11,.16);color:var(--warn)}.tag.suporte{background:rgba(169,159,196,.18);color:var(--muted)}
.switch{position:relative;width:48px;height:27px;flex:none}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:var(--line);border-radius:999px;cursor:pointer;transition:.2s}
.slider:before{content:'';position:absolute;height:21px;width:21px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.switch input:checked+.slider{background:linear-gradient(90deg,var(--accent),var(--accent2))}
.switch input:checked+.slider:before{transform:translateX(21px)}
.switch input:disabled+.slider{opacity:.4;cursor:not-allowed}
/* accordion entrevista */
.acc{border:1px solid var(--line);border-radius:12px;margin-top:10px;overflow:hidden;display:none}
.acc.show{display:block}
.acc-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;cursor:pointer;font-weight:700;color:var(--accent)}
.acc-head .chev{transition:.2s;color:var(--muted)}
.acc.open .acc-head .chev{transform:rotate(180deg)}
.acc-body{max-height:0;overflow:hidden;transition:max-height .3s ease;padding:0 15px}
.acc.open .acc-body{max-height:2000px;padding:0 15px 14px}
.hint{color:var(--muted);font-size:12px;margin-top:3px}
/* chips (multichoice) */
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.chip{border:1px solid var(--line);background:transparent;color:var(--fg);padding:7px 13px;border-radius:999px;font-size:13px;cursor:pointer;transition:.15s;font-family:inherit}
.chip:hover{border-color:var(--accent)}
.chip.on{background:linear-gradient(90deg,var(--accent),var(--accent2));border-color:transparent;color:#fff;font-weight:600}
.train{background:linear-gradient(90deg,rgba(16,185,129,.16),rgba(139,92,246,.08));border:1px solid rgba(16,185,129,.35)}.train h2{color:var(--ok)}
.wa{display:inline-flex;align-items:center;gap:8px;margin-top:10px;background:#25d366;color:#062e18;font-weight:800;padding:11px 18px;border-radius:10px;text-decoration:none}
.wa:hover{filter:brightness(1.05)}
.stub{border-style:dashed}
.btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:none;padding:15px 22px;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;width:100%;justify-content:center;box-shadow:0 12px 30px rgba(139,92,246,.32)}
.btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
.muted{color:var(--muted);font-size:13px}
.result{white-space:pre-wrap;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;display:none}.result.show{display:block}
.overlay{position:fixed;inset:0;background:rgba(9,6,18,.88);backdrop-filter:blur(5px);display:none;align-items:center;justify-content:center;flex-direction:column;z-index:9}.overlay.show{display:flex}
.ring{transform:rotate(-90deg)}.ring .track{stroke:var(--line)}.ring .bar{stroke:url(#g);stroke-linecap:round;transition:stroke-dashoffset .35s ease}
.pct{font-size:34px;font-weight:850;position:absolute}.stage{color:var(--muted);margin-top:10px}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:18px}
`;

function renderField(setId, q) {
  const req = q.required ? '<span class="req">*</span>' : '';
  const help = q.help ? `<div class="hint">${esc(q.help)}</div>` : '';
  const reqAttr = q.required ? 'data-req="1"' : '';
  let field;
  if (q.tipo === 'longtext' || q.tipo === 'list') {
    field = `<textarea data-id="${q.id}" data-set="${setId}" data-tipo="${q.tipo}" ${reqAttr} placeholder="${q.tipo === 'list' ? 'um por linha' : ''}"></textarea>`;
  } else if (q.tipo === 'number') {
    field = `<input type="number" step="any" data-id="${q.id}" data-set="${setId}" data-tipo="number" ${reqAttr}>`;
  } else if (q.tipo === 'choice') {
    field = `<select data-id="${q.id}" data-set="${setId}" data-tipo="choice" ${reqAttr}><option value="">Selecione…</option>${q.opcoes.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  } else if (q.tipo === 'multichoice') {
    field = `<div class="chips" data-id="${q.id}" data-set="${setId}" data-tipo="multichoice" ${reqAttr}>${q.opcoes.map((o) => `<button type="button" class="chip" data-val="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  } else {
    field = `<input type="text" data-id="${q.id}" data-set="${setId}" data-tipo="text" ${reqAttr}>`;
  }
  return `<label class="fl">${esc(q.pergunta)} ${req}</label>${field}${help}`;
}

function renderAcc(setId) {
  const nomes = { empresa: 'Empresa', vendas: 'Vendas + Marketing', dev: 'Dev · branch / commit / doc', analista: 'Analista · acesso ao tracker', qa: 'QA · acesso à doc de testes' };
  return `<div class="acc" data-setgrp="${setId}">
    <div class="acc-head" data-acctoggle><span>${esc(nomes[setId] || setId)}</span><span class="chev">▾</span></div>
    <div class="acc-body">${SETS[setId].map((q) => renderField(setId, q)).join('')}</div>
  </div>`;
}

export function renderInstaller() {
  const prods = PRODUTOS.map((p) => {
    const soon = p.status !== 'available';
    return `<div class="prod ${soon ? 'soon' : ''}">
      <div><span class="n">${esc(p.nome)}<span class="tag ${soon ? 'soon' : p.linha}">${soon ? 'em breve' : p.linha}</span></span>
        <div class="d">${esc(p.desc)}</div></div>
      <label class="switch"><input type="checkbox" class="prodchk" value="${p.id}" ${soon ? 'disabled' : ''}><span class="slider"></span></label>
    </div>`;
  }).join('');
  const accs = Object.keys(SETS).map(renderAcc).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Instalar VelosoSolution</title><style>${CSS}</style></head><body>
<div class="wrap">
  <div class="hero"><div><div class="brand">Veloso<b>Solution</b></div><div class="sub">Instalador — automação com IA pro seu time</div></div>
    <span class="badge">Teste grátis · ${TRIAL_DAYS} dias</span></div>

  <form id="f">
    <div class="card"><h2>1 · Seus dados</h2>
      <div class="row"><div><label class="fl">Nome</label><input type="text" name="nome" required></div>
      <div><label class="fl">Empresa</label><input type="text" name="empresa"></div></div>
      <label class="fl">WhatsApp (recebe a chave do teste)</label><input type="tel" name="whatsapp" placeholder="(31) 97512-7978" required></div>

    <div class="card"><h2>2 · Ative os produtos</h2>
      <p class="muted">Ligue a chave do que quer instalar — só aí os dados daquele produto abrem abaixo.</p>
      ${prods}</div>

    <div class="card"><h2>3 · Configuração</h2>
      <p class="muted" id="cfghint">Ligue um produto acima pra abrir os campos.</p>
      ${accs}</div>

    <div class="card stub"><h2>4 · Pagamento</h2>
      <p class="muted">Stub — Stripe entra aqui. No teste de ${TRIAL_DAYS} dias você não paga nada agora.</p></div>

    <div class="card train"><h2>🎓 Treinamento grátis</h2>
      <p>Todo cliente tem <b>treinamento gratuito</b>. <b>Recomendamos fortemente</b> fazer antes de começar.</p>
      <a class="wa" href="${whatsappLink('Quero agendar o treinamento gratis do VelosoSolution')}" target="_blank" rel="noopener">💬 Falar no WhatsApp e agendar</a></div>

    <button class="btn" id="go" type="submit">Instalar na minha máquina →</button>
    <div class="muted" style="margin-top:8px">Detectamos sua IDE / IA (Claude Code, Cursor, Windsurf…) e instalamos o MCP no lugar certo.</div>
    <div class="result" id="r"></div>
  </form>
  <div class="foot">VelosoSolution · a suite adota o padrão da sua empresa — nada de default, nada de banco.</div>
</div>

<div class="overlay" id="ov">
  <svg width="180" height="180" viewBox="0 0 180 180" class="ring">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
    <circle class="track" cx="90" cy="90" r="78" fill="none" stroke-width="12"/>
    <circle class="bar" id="bar" cx="90" cy="90" r="78" fill="none" stroke-width="12" stroke-dasharray="490" stroke-dashoffset="490"/>
  </svg>
  <div class="pct" id="pct">0%</div><div class="stage" id="stage">preparando…</div>
</div>

<script>
const SETS=${JSON.stringify(SETS)};
const DEV_FLOW=['gate','vsqa','vsanalista','vsdiretoria'];
const f=document.getElementById('f'),r=document.getElementById('r'),go=document.getElementById('go');
const ov=document.getElementById('ov'),bar=document.getElementById('bar'),pct=document.getElementById('pct'),stage=document.getElementById('stage');const C=490;

function activeSets(){const ids=[...f.querySelectorAll('.prodchk:checked')].map(x=>x.value);const s=new Set();
  if(ids.some(i=>DEV_FLOW.includes(i))){['empresa','dev','analista','qa'].forEach(x=>s.add(x));}
  if(ids.includes('vsvendas')){s.add('empresa');s.add('vendas');}return s;}
function refresh(){const s=activeSets();let any=false;
  document.querySelectorAll('.prodchk').forEach(c=>c.closest('.prod').classList.toggle('on',c.checked));
  document.querySelectorAll('[data-setgrp]').forEach(g=>{const on=s.has(g.dataset.setgrp);
    g.classList.toggle('show',on);if(on){g.classList.add('open');any=true;}else{g.classList.remove('open');}});
  document.getElementById('cfghint').style.display=any?'none':'block';}
f.querySelectorAll('.prodchk').forEach(c=>c.addEventListener('change',refresh));refresh();

// accordion abre/fecha ao clicar no cabeçalho
document.querySelectorAll('[data-acctoggle]').forEach(h=>h.addEventListener('click',()=>h.closest('.acc').classList.toggle('open')));
// chips
document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>c.classList.toggle('on')));

function collect(){const s=activeSets();const respostas={};let faltou=null;
  document.querySelectorAll('[data-setgrp]').forEach(g=>{const set=g.dataset.setgrp;if(!s.has(set))return;respostas[set]={};
    g.querySelectorAll('[data-id]').forEach(el=>{const id=el.dataset.id,tipo=el.dataset.tipo;let v,empty;
      if(tipo==='multichoice'){v=[...el.querySelectorAll('.chip.on')].map(x=>x.dataset.val);empty=v.length===0;}
      else{v=(el.value||'').trim();empty=v==='';}
      if(!empty)respostas[set][id]=v;
      if(el.dataset.req&&empty&&!faltou){const lbl=el.parentElement.querySelector('label.fl');faltou=set+': '+(lbl?lbl.textContent.replace('*','').trim():id);
        // abre o accordion do campo que faltou
        g.classList.add('open');}});});
  return {respostas,faltou};}

function setPct(p){bar.setAttribute('stroke-dashoffset',C-(C*p/100));pct.textContent=Math.round(p)+'%';}
let timer=null;
function animateTo(target,ms){clearInterval(timer);const start=parseFloat(pct.textContent)||0;const t0=Date.now();
  timer=setInterval(()=>{const k=Math.min(1,(Date.now()-t0)/ms);setPct(start+(target-start)*k);if(k>=1)clearInterval(timer);},40);}

f.addEventListener('submit',async(e)=>{e.preventDefault();
  if(![...f.querySelectorAll('.prodchk:checked')].length){r.className='result show';r.textContent='⚠ Ligue ao menos um produto.';return;}
  const {respostas,faltou}=collect();
  if(faltou){r.className='result show';r.textContent='⚠ Preencha os obrigatórios — '+faltou;return;}
  const fd=new FormData(f);const produtos=[...f.querySelectorAll('.prodchk:checked')].map(x=>x.value);
  ov.classList.add('show');setPct(0);const stages=['validando dados','emitindo chave de 7 dias','detectando sua IDE','instalando o MCP'];
  let si=0;stage.textContent=stages[0];animateTo(85,2600);const rot=setInterval(()=>{si=(si+1)%stages.length;stage.textContent=stages[si];},700);
  try{
    const resp=await fetch('/install',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nome:fd.get('nome'),empresa:fd.get('empresa'),whatsapp:fd.get('whatsapp'),produtos,respostas})});
    const d=await resp.json();clearInterval(rot);
    if(!d.ok){animateTo(0,300);setTimeout(()=>{ov.classList.remove('show');r.className='result show';r.textContent='⚠ '+(d.erros||['falha']).join('\\n');},400);return;}
    stage.textContent='concluído';animateTo(100,500);
    let out='✅ Instalado!\\n\\nProdutos: '+d.escolhidos.join(', ')+'\\n';
    out+=d.trial.token?('Chave de teste ('+d.trial.days+' dias):\\n'+d.trial.token+'\\n'):('Teste de '+d.trial.days+' dias: '+d.trial.reason+' (mandamos a chave no seu WhatsApp).\\n');
    out+='\\n'+(d.semFerramenta?'Nenhuma IDE/IA detectada — te mando o passo manual.':'MCP instalado em:\\n'+d.configurados.map(c=>' • '+c.tool+(c.erro?' (erro)':' → '+c.path)).join('\\n'));
    out+='\\n\\n🎓 '+d.treinamento.mensagem;
    setTimeout(()=>{ov.classList.remove('show');r.className='result show';r.textContent=out;go.textContent='Concluído ✓';go.disabled=true;},700);
  }catch(err){clearInterval(rot);ov.classList.remove('show');r.className='result show';r.textContent='✖ '+err.message;}
});
</script>
</body></html>`;
}
