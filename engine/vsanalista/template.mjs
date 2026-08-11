/**
 * VSanalista — template. Reproduz o padrão REAL dos analistas do RURAP no Redmine:
 * Épico (tracker 37), História do Usuário (38) e as 3 Tarefas Técnicas (40) por HU.
 *
 * Estrutura da HU (extraída de HUs reais): Como/Solicito/Para -> Como Implementar
 * (Pré/Pós-condição, Fluxos, Regras, Atributos) -> Possui Integração -> Critério de
 * Aceitação do Teste de Software -> Critério de Aceitação da História na Sprint.
 */

/** IDs fixos do RURAP (projeto 66). */
export const TRACKERS = { epico: 37, hu: 38, tarefaTecnica: 40, defeito: 39, melhoriaHu: 43 };
export const CUSTOM_FIELDS = { tarefaPlanejada: 7, pontosMsb: 17, categoriaTamanho: 20 };

/** As 3 filhas que toda HU recebe (nome exato + a quem vai). */
export const HU_TASKS = [
  { name: 'Codificar História do Usuário', role: 'dev' },
  { name: 'Especificar Testes', role: 'qa' },
  { name: 'Execução dos testes', role: 'qa' },
];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const li = (s) => `<li>${esc(s)}</li>`;
const list = (arr, fallback) => {
  const items = (arr && arr.length ? arr : [fallback]).filter(Boolean);
  return `<ol>${items.map(li).join('')}</ol>`;
};

/** Título da HU no padrão "[Módulo] Deve ...". */
export function huSubject(hu) {
  const mod = hu.modulo ? `[${hu.modulo}] ` : '';
  return `${mod}${hu.titulo}`.trim();
}

/**
 * Descrição HTML da HU no template do RURAP.
 * Campos ausentes viram placeholder "<preencher>" pra o analista/modelo completar.
 */
export function renderHUDescription(hu) {
  const a = hu.atributos || {};
  return [
    '<ol>',
    '<li><b>Descrição de História de Usuário:</b>',
    '<ol>',
    `<li><strong>Como:</strong> ${esc(hu.como || 'Usuário')}</li>`,
    `<li><strong>Solicito:</strong> ${esc(hu.solicito || hu.titulo || '<preencher>')}</li>`,
    `<li><strong>Para:</strong> ${esc(hu.para || '<preencher o benefício>')}</li>`,
    '</ol></li>',
    '<li><b>Como Implementar?</b>',
    '<ol>',
    `<li><b>Pré-Condição:</b>${list(hu.preCondicoes, 'Usuário autenticado com permissão.')}</li>`,
    `<li><b>Pós-Condição:</b>${list(hu.posCondicoes, '<preencher resultado esperado>')}</li>`,
    `<li><b>Fluxos de Eventos:</b>${list(hu.fluxos, '<preencher passo a passo>')}</li>`,
    `<li><b>Regras:</b>${list(hu.regras, '<preencher regras de negócio>')}</li>`,
    '<li><b>Atributos:</b><ol>',
    `<li>Acessibilidade: ${esc(a.acessibilidade || 'A interface deve estar acessível aos usuários autorizados.')}</li>`,
    `<li>Confirmação: ${esc(a.confirmacao || 'Não se aplica.')}</li>`,
    `<li>Disponibilidade: ${esc(a.disponibilidade || 'Disponível apenas para usuários com permissão.')}</li>`,
    `<li>Notificação: ${esc(a.notificacao || 'Não se aplica.')}</li>`,
    '</ol></li>',
    '</ol></li>',
    `<li><b>Possui Integração:</b> ${hu.integra ? '(x) Sim ( ) Não' : '( ) Sim (x) Não'}</li>`,
    `<li><b>Critério de Aceitação do Teste de Software:</b>${list(hu.criteriosTeste, '<preencher critérios verificáveis>')}</li>`,
    `<li><b>Critério de Aceitação da História na Sprint:</b>${list(hu.criteriosSprint, 'A funcionalidade deve ser implementada e testada conforme os critérios de aceitação.')}</li>`,
    '</ol>',
  ].join('\n');
}

/** Descrição do Épico: lista numerada "NN - [Módulo] título" (uma por HU). */
export function renderEpicDescription(hus) {
  return (hus || [])
    .map((h, i) => `${String(i + 1).padStart(2, '0')} - ${huSubject(h)}`)
    .join('<br>\n');
}
