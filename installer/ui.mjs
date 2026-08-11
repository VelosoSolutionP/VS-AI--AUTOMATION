/**
 * Instalador — UI premium (HTML self-contained, dark/light). Servida em localhost.
 * Cadastro + stub de pagamento + picker de módulos + banner de treinamento grátis.
 */
import { PRODUTOS, TRIAL_DAYS } from './catalog.mjs';

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
input[type=text],input[type=email]{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--fg);font-size:14px}
input:focus{outline:none;border-color:var(--accent)}
.prod{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;margin-top:10px;cursor:pointer;transition:.15s}
.prod:hover{border-color:var(--accent)}
.prod.soon{opacity:.55;cursor:not-allowed}
.prod input{margin-top:3px;width:18px;height:18px;accent-color:var(--accent)}
.prod .n{font-weight:700}.prod .d{color:var(--muted);font-size:13px}
.tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px}
.tag.dev{background:rgba(109,94,252,.18);color:var(--accent)}.tag.vendas{background:rgba(34,211,238,.16);color:var(--accent2)}.tag.soon{background:rgba(245,158,11,.16);color:var(--warn)}.tag.suporte{background:rgba(148,160,189,.18);color:var(--muted)}
.train{background:linear-gradient(90deg,rgba(34,197,94,.16),rgba(34,211,238,.10));border:1px solid rgba(34,197,94,.35)}
.train h2{color:var(--ok)}
.stub{border-style:dashed}
.btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:none;padding:14px 22px;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;width:100%;justify-content:center}
.btn:disabled{opacity:.5;cursor:not-allowed}
.muted{color:var(--muted);font-size:13px}
.result{white-space:pre-wrap;background:rgba(0,0,0,.2);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;display:none}
.result.show{display:block}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:18px}
`;

export function renderInstaller() {
  const prods = PRODUTOS.map((p) => {
    const soon = p.status !== 'available';
    return `<label class="prod ${soon ? 'soon' : ''}">
      <input type="checkbox" name="produto" value="${p.id}" ${soon ? 'disabled' : 'checked'}>
      <span><span class="n">${esc(p.nome)}<span class="tag ${soon ? 'soon' : p.linha}">${soon ? 'em breve' : p.linha}</span></span>
      <div class="d">${esc(p.desc)}</div></span></label>`;
  }).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Instalar VelosoSolution</title><style>${CSS}</style></head><body>
<div class="wrap">
  <div class="hero">
    <div><div class="brand">Veloso<b>Solution</b></div><div class="sub">Instalador — automação com IA pro seu time</div></div>
    <span class="badge">Teste grátis · ${TRIAL_DAYS} dias</span>
  </div>

  <form id="f">
    <div class="card"><h2>1 · Seus dados</h2>
      <div class="row">
        <div><label>Nome</label><input type="text" name="nome" required></div>
        <div><label>Empresa</label><input type="text" name="empresa"></div>
      </div>
      <label>E-mail (recebe a chave do teste)</label><input type="email" name="email" required>
    </div>

    <div class="card"><h2>2 · Escolha os produtos</h2>
      <p class="muted">Marque o que quer instalar. A chave de teste vale ${TRIAL_DAYS} dias.</p>
      ${prods}
    </div>

    <div class="card stub"><h2>3 · Pagamento</h2>
      <p class="muted">Stub — integração de pagamento (Stripe) entra aqui. No teste de ${TRIAL_DAYS} dias você não paga nada agora.</p>
    </div>

    <div class="card train"><h2>🎓 Treinamento grátis</h2>
      <p>Todo cliente tem <b>treinamento gratuito</b> pra tirar o máximo da suite. <b>Recomendamos fortemente</b> fazer antes de começar — fala com a gente pra agendar.</p>
    </div>

    <button class="btn" id="go" type="submit">Instalar na minha máquina →</button>
    <div class="muted" style="margin-top:8px">Detectamos sua IDE / ferramenta de IA (Claude Code, Cursor, Windsurf…) e instalamos o MCP no lugar certo.</div>
    <div class="result" id="r"></div>
  </form>

  <div class="foot">VelosoSolution · a suite adota o padrão da sua empresa (entrevista de onboarding) — nada de default.</div>
</div>
<script>
const f=document.getElementById('f'),r=document.getElementById('r'),go=document.getElementById('go');
f.addEventListener('submit',async(e)=>{e.preventDefault();
  const fd=new FormData(f);
  const produtos=[...f.querySelectorAll('input[name=produto]:checked')].map(x=>x.value);
  go.disabled=true;go.textContent='Instalando…';r.className='result show';r.textContent='Instalando…';
  try{
    const resp=await fetch('/install',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nome:fd.get('nome'),empresa:fd.get('empresa'),email:fd.get('email'),produtos})});
    const d=await resp.json();
    if(!d.ok){r.textContent='⚠ '+(d.erros||['falha']).join('\\n');go.disabled=false;go.textContent='Tentar de novo';return;}
    let out='✅ Instalado!\\n\\nProdutos: '+d.escolhidos.join(', ')+'\\n';
    out+=d.trial.token?('Chave de teste ('+d.trial.days+' dias):\\n'+d.trial.token+'\\n'):('Teste de '+d.trial.days+' dias: '+d.trial.reason+' (enviaremos a chave no seu e-mail).\\n');
    out+='\\n'+(d.semFerramenta?'Nenhuma IDE/IA detectada — te mando o passo manual do MCP.':'MCP instalado em:\\n'+d.configurados.map(c=>' • '+c.tool+(c.erro?(' (erro: '+c.erro+')'):(' → '+c.path))).join('\\n'));
    out+='\\n\\n🎓 '+d.treinamento.mensagem;
    r.textContent=out;go.textContent='Concluído ✓';
  }catch(err){r.textContent='✖ '+err.message;go.disabled=false;go.textContent='Tentar de novo';}
});
</script>
</body></html>`;
}
