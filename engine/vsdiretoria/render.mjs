/**
 * VSdiretoria — render. Monta o HTML executivo self-contained (CSS/SVG inline,
 * dark/light) a partir dos KPIs. Puro: computeKpis -> html. Serve pra abrir no
 * browser e pra exportar em PDF (Playwright).
 */
import { donut, legend, columns, barsH, gauge } from './charts.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--fg:#0f172a;--muted:#64748b;--grid:#e2e8f0;--line:#eef2f7;
--c1:#4f46e5;--c2:#0ea5e9;--c3:#f59e0b;--c4:#ef4444;--c5:#10b981;--c6:#a855f7;
--ok:#10b981;--warn:#f59e0b;--bad:#ef4444;--accent:#4f46e5;}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#141a2e;--fg:#e6eaf5;--muted:#94a3b8;--grid:#26304a;--line:#1c2438;}}
:root[data-theme=dark]{--bg:#0b1020;--card:#141a2e;--fg:#e6eaf5;--muted:#94a3b8;--grid:#26304a;--line:#1c2438;}
:root[data-theme=light]{--bg:#f6f7fb;--card:#fff;--fg:#0f172a;--muted:#64748b;--grid:#e2e8f0;--line:#eef2f7;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,Roboto,Inter,sans-serif;padding:28px}
.wrap{max-width:1120px;margin:0 auto}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px;border-bottom:1px solid var(--line);padding-bottom:16px}
.brand{font-size:22px;font-weight:800;letter-spacing:-.02em}.brand b{color:var(--accent)}
.sub{color:var(--muted);font-size:13px;margin-top:2px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.tile .k{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.tile .v{font-size:30px;font-weight:800;margin-top:6px;letter-spacing:-.02em}
.tile .m{font-size:12px;color:var(--muted);margin-top:2px}
.tile.bad .v{color:var(--bad)}.tile.ok .v{color:var(--ok)}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.card h3{margin:0 0 12px;font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.col-4{grid-column:span 4}.col-5{grid-column:span 5}.col-6{grid-column:span 6}.col-7{grid-column:span 7}.col-8{grid-column:span 8}.col-12{grid-column:span 12}
.donutwrap{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.donut-num{font-size:26px;font-weight:800;fill:var(--fg)}.donut-lbl{font-size:11px;fill:var(--muted)}
.legend{list-style:none;margin:0;padding:0;flex:1;min-width:180px}
.legend li{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px}
.legend .dot{width:10px;height:10px;border-radius:3px;flex:none}.legend b{margin-left:auto;font-weight:700}.legend em{color:var(--muted);font-style:normal;width:40px;text-align:right}
.gauges{display:flex;gap:10px;justify-content:space-around;flex-wrap:wrap}
.gaugebox{text-align:center}.gaugebox p{margin:4px 0 0;font-size:12px;color:var(--muted)}
.gauge-num{font-size:22px;font-weight:800;fill:var(--fg)}.gauge-lbl{font-size:10px;fill:var(--muted)}
.bars{display:flex;flex-direction:column;gap:9px}
.bar-row{display:grid;grid-template-columns:150px 1fr 52px;align-items:center;gap:10px;font-size:13px}
.bar-lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--fg)}
.bar-track{background:var(--grid);height:9px;border-radius:6px;overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:6px}
.bar-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:600}
.cols .col-x{font-size:3.4px;fill:var(--muted)}.cols .col-v{font-size:3.6px;fill:var(--fg);font-weight:700}
.empty{color:var(--muted);font-size:13px;padding:12px 0}
.foot{margin-top:20px;color:var(--muted);font-size:11px;text-align:center;border-top:1px solid var(--line);padding-top:12px}
@media print{body{padding:0}.card,.tile{box-shadow:none;break-inside:avoid}}
@media(max-width:840px){.tiles{grid-template-columns:repeat(2,1fr)}.grid>*{grid-column:span 12!important}}
`;

function tile(k, v, m, cls = '') {
  return `<div class="tile ${cls}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${m ? `<div class="m">${esc(m)}</div>` : ''}</div>`;
}

/** KPIs -> HTML completo (conteúdo do <body>, sem <html>/<head>). */
export function renderDashboard(kpis, opts = {}) {
  const t = kpis.tiles;
  const ad = kpis.aderencia;
  const periodo = kpis.periodo ? `${kpis.periodo.desde || '—'} a ${kpis.periodo.ate || 'hoje'}` : 'período completo';
  const geradoEm = opts.geradoEm || '';

  return `<style>${CSS}</style>
<div class="wrap">
  <div class="head">
    <div><div class="brand">Veloso<b>Solution</b> · Painel da Diretoria</div>
      <div class="sub">${esc(kpis.projeto || 'Projeto')} · ${esc(periodo)}</div></div>
    <div class="sub">Produtividade · Qualidade · Governança</div>
  </div>

  <div class="tiles">
    ${tile('Entregues', t.entregues, `${t.taxaEntrega}% do total`, 'ok')}
    ${tile('Em aberto', t.emAberto, 'work in progress')}
    ${tile('Defeitos', t.defeitos, `${t.defeitosPorHU} por história`, t.defeitosPorHU >= 1 ? 'bad' : '')}
    ${tile('Não Conformidades', t.naoConformidades, 'auditoria')}
  </div>
  <div class="tiles">
    ${tile('Histórias de Usuário', t.historias, 'entregues + backlog')}
    ${tile('Épicos', t.epicos, 'iniciativas')}
    ${tile('Pontos (amostra)', t.pontosEntreguesAmostra, 'velocity recente')}
    ${tile('Aderência ao fluxo', `${ad.comTree}%`, `amostra ${ad.amostra} HUs`, ad.comTree >= 80 ? 'ok' : ad.comTree < 50 ? 'bad' : '')}
  </div>

  <div class="grid">
    <div class="card col-5"><h3>Composição do trabalho</h3>
      <div class="donutwrap">${donut(kpis.mix)}${legend(kpis.mix)}</div></div>

    <div class="card col-7"><h3>Entregas por mês</h3>${columns(kpis.fechadasMes)}</div>

    <div class="card col-6"><h3>Entregas por responsável</h3>${barsH(kpis.responsaveis)}</div>

    <div class="card col-6"><h3>Horas apontadas por pessoa</h3>${barsH(kpis.horas, { unit: 'h' })}</div>

    <div class="card col-8"><h3>Governança · aderência ao fluxo VelosoSolution</h3>
      <div class="gauges">
        <div class="gaugebox">${gauge(ad.comTree)}<p>HU com 3 tarefas</p></div>
        <div class="gaugebox">${gauge(ad.comCenario)}<p>com "Especificar Testes"</p></div>
        <div class="gaugebox">${gauge(ad.comExecucao)}<p>com "Execução de testes"</p></div>
        <div class="gaugebox">${gauge(t.taxaEntrega)}<p>taxa de entrega</p></div>
      </div></div>

    <div class="card col-4"><h3>Automação (VSanalista · VSqa)</h3>
      ${tile('Issues por automação', kpis.automacao.issuesAutomacao, 'criadas pela suite')}
      <div style="height:10px"></div>
      ${tile('Gates verdes (QA)', kpis.automacao.gatesVerdes, 'bug barrado no commit', 'ok')}</div>
  </div>

  <div class="foot">Gerado por VSdiretoria · VelosoSolution${geradoEm ? ` · ${esc(geradoEm)}` : ''} · dados: Redmine</div>
</div>`;
}

/** Envelopa o conteúdo num documento HTML completo (pro arquivo/pdf). */
export function renderDocument(kpis, opts = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel da Diretoria · VelosoSolution</title></head>
<body>${renderDashboard(kpis, opts)}</body></html>`;
}
