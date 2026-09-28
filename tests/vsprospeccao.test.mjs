import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vsprosp-'));
process.env.VSPROSPECCAO_DIR = dir;
const p = await import('../engine/vsprospeccao/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));
const D0 = new Date('2026-09-28T12:00:00Z');
const dias = (n) => new Date(D0.getTime() + n * 86400000);

test('plano: propósito, período, meta e quem aprovou ficam gravados', () => {
  assert.equal(p.salvarPlano({ nome: 'x', proposito: '', inicio: '2026-09-28', fim: '2026-10-28', meta: 5 }).ok, false);
  assert.equal(p.salvarPlano({ nome: 'x', proposito: 'y', inicio: '2026-10-28', fim: '2026-09-28', meta: 5 }).ok, false, 'fim antes do início');
  const r = p.salvarPlano({ nome: 'Interior', proposito: 'descobrir onde vende', inicio: '2026-09-28', fim: '2026-10-27', meta: 5, aprovadoPor: 'Fabiano Veloso — tech lead do projeto' }, { agora: D0 });
  assert.equal(r.ok, true);
  assert.equal(r.plano.aprovacao.por, 'Fabiano Veloso — tech lead do projeto');
  const pn = p.painel({ agora: dias(4) }).plano;
  assert.equal(pn.duracaoDias, 30);
  assert.equal(pn.diaAtual, 5);
});

test('região nasce com a primeira abordagem (a mais barata) e guarda o que já foi tentado', () => {
  const r = p.salvarRegiao({ nome: 'Vale do Jequitinhonha', uf: 'mg', cidades: 'Araçuaí, Diamantina' }, { agora: D0 }).regiao;
  assert.equal(r.uf, 'MG');
  assert.equal(r.abordagem, 'mensagem-direta');
  assert.deepEqual(r.tentadas.map((t) => t.abordagem), ['mensagem-direta']);
  assert.equal(p.salvarRegiao({ nome: '', uf: 'MG' }).ok, false);
});

test('cadência do dono: 1ª mensagem no dia 0, 2ª no dia 5, ligação no dia 10; depois, esgotado', () => {
  const rg = p.painel().regioes[0];
  const c = p.registrarContato({ regiaoId: rg.id, nome: 'Loja A', whatsapp: '(33) 99999-0001' }, { agora: D0 }).contato;
  assert.equal(c.proximo.quando.slice(0, 10), '2026-10-03');
  assert.match(c.proximo.oque, /2ª mensagem/);
  assert.equal(p.proximoToque(c, dias(4)).vencido, false);
  assert.equal(p.proximoToque(c, dias(5)).vencido, true);
  const t2 = p.mover(c.id, 'toque', { agora: dias(5) }).contato;
  assert.equal(t2.proximo.quando.slice(0, 10), '2026-10-08');
  assert.match(t2.proximo.oque, /ligação/);
  const t3 = p.mover(c.id, 'toque', { agora: dias(10) }).contato;
  assert.equal(t3.proximo.esgotado, true, 'depois da ligação do dia 10 não se cutuca mais');
  assert.equal(p.registrarContato({ regiaoId: rg.id, nome: 'Outra', whatsapp: '33999990001' }).ok, false, 'mesmo WhatsApp não entra duas vezes');
});

test('5 sem resposta e nenhum retorno na abordagem da vez: manda trocar e sugere a próxima não tentada', () => {
  const rg = p.painel().regioes[0];
  for (let i = 2; i <= 5; i++) {
    const c = p.registrarContato({ regiaoId: rg.id, nome: `Loja ${i}` }, { agora: D0 }).contato;
    p.mover(c.id, 'sem-resposta', { agora: dias(11) });
  }
  let s = p.painel({ agora: dias(11) }).regioes[0];
  assert.equal(s.naAbordagem.semResposta, 5, 'o que esgotou a cadência conta como sem resposta');
  assert.equal(s.trocar, true);
  assert.equal(s.situacao, 'trocar');
  assert.equal(s.sugestao, 'grupo-local');
  assert.equal(p.trocarAbordagem(rg.id, 'grupo-local', { motivo: 'ninguém respondeu', agora: dias(11) }).ok, true);
  s = p.painel({ agora: dias(11) }).regioes[0];
  assert.equal(s.abordagem, 'grupo-local');
  assert.equal(s.trocar, false, 'a abordagem nova começa do zero');
  assert.equal(s.tentadas[0].motivo, 'ninguém respondeu');
  assert.equal(s.contatos, 5, 'os contatos antigos continuam contando na região');
});

test('um retorno já basta pra não mandar trocar; cliente conta na meta', () => {
  const rg = p.salvarRegiao({ nome: 'Norte de Minas', uf: 'MG' }, { agora: D0 }).regiao;
  const ids = [];
  for (let i = 0; i < 6; i++) { ids.push(p.registrarContato({ regiaoId: rg.id, nome: `N${i}` }, { agora: D0 }).contato.id); }
  ids.slice(0, 5).forEach((i) => p.mover(i, 'sem-resposta'));
  p.mover(ids[5], 'cliente');
  const pn = p.painel({ agora: dias(11) });
  const s = pn.regioes.find((r) => r.id === rg.id);
  assert.equal(s.trocar, false);
  assert.equal(s.clientes, 1);
  assert.equal(pn.plano.clientes, 1);
  assert.equal(p.mover(ids[5], 'toque').ok, false, 'quem já virou cliente não recebe toque');
});

test('lista pública (Receita): entra "na lista", CNPJ repetido não duplica, fonte gravada; 1º contato inicia a cadência', () => {
  const rg = p.salvarRegiao({ nome: 'Mato Grosso', uf: 'MT' }, { agora: D0 }).regiao;
  const emp = [{ cnpj: '12.345.678/0001-90', nome: 'AGRO PECAS LTDA', cidade: 'SORRISO', segmento: 'Máquinas agrícolas; peças', whatsapp: 'https://wa.me/5566999990000', email: 'Contato@Agro.com' },
    { cnpj: '12345678000190', nome: 'repetida' }, { cnpj: '98765432000111', nome: 'OFICINA X' }];
  const r = p.importarLista(rg.id, emp, { fonte: 'Receita Federal — dados abertos do CNPJ (2026-09)', agora: D0 });
  assert.deepEqual([r.novos, r.repetidos], [2, 1]);
  const pn = p.painel({ agora: D0, regiaoId: rg.id });
  const s = pn.regioes.find((x) => x.id === rg.id);
  assert.equal(s.naLista, 2); assert.equal(s.contatos, 0); assert.equal(s.situacao, 'lista');
  const c = pn.contatos.find((x) => x.cnpj === '12345678000190');
  assert.equal(c.etapa, 'na-lista'); assert.equal(c.whatsapp, '66999990000'); assert.equal(c.email, 'contato@agro.com'); assert.match(c.fonte, /Receita Federal/);
  assert.equal(c.proximo, null, 'na lista não tem cadência');
  const m = p.mover(c.id, 'contatado', { agora: dias(1) }).contato;
  assert.equal(m.toques, 1); assert.equal(m.proximo.quando.slice(0, 10), '2026-10-04', '5 dias depois do 1º contato');
  assert.equal(p.painel({ busca: 'oficina' }).filtrados, 1, 'busca por nome');
  assert.equal(p.removerRegiao(rg.id).ok, false, 'região com contato não sai');
});

test('WhatsApp: link com texto pronto só pros toques de mensagem; a 1ª diz a fonte e todas oferecem o SAIR', () => {
  const rg = p.salvarRegiao({ nome: 'Serra Gaúcha', uf: 'RS' }, { agora: D0 }).regiao;
  p.importarLista(rg.id, [{ cnpj: '40000000000101', nome: 'AGRO SERRA', segmento: 'Máquinas agrícolas | Peças', whatsapp: '54999990000' }], { fonte: 'Receita', agora: D0 });
  const achar = () => p.painel({ agora: D0, regiaoId: rg.id, loja: 'Bolso Cheio', vendedor: 'Ana' }).contatos.find((c) => c.cnpj === '40000000000101');
  let c = achar();
  assert.equal(c.wa.toque, 1);
  const t1 = decodeURIComponent(c.wa.url);
  assert.match(t1, /^https:\/\/wa\.me\/5554999990000\?text=/);
  assert.match(t1, /Aqui é Ana, da Bolso Cheio/); assert.match(t1, /Receita Federal/); assert.match(t1, /SAIR/);
  const m = p.mover(c.id, 'contatado', { canal: 'whatsapp', por: 'Ana', agora: D0 }).contato;
  assert.equal(m.historico.at(-1).canal, 'whatsapp');
  c = achar();
  assert.equal(c.wa.toque, 2); assert.match(decodeURIComponent(c.wa.url), /SAIR/);
  p.mover(c.id, 'toque', { agora: dias(5) });
  assert.equal(achar().wa, null, 'o 3º toque é ligação, não mensagem');
});

test('pediu pra sair: apaga contato pessoal, bloqueia o número e não volta na importação nem no cadastro manual', () => {
  const rg = p.painel().regioes.find((r) => r.nome === 'Serra Gaúcha');
  p.importarLista(rg.id, [{ cnpj: '40000000000202', nome: 'MEI JOAO', whatsapp: '5554988887777', telefone: '5433334444', email: 'joao@gmail.com', responsavel: 'João' }], { fonte: 'Receita', agora: D0 });
  const c = p.painel({ regiaoId: rg.id }).contatos.find((x) => x.cnpj === '40000000000202');
  p.mover(c.id, 'contatado', { agora: D0 });
  const s = p.mover(c.id, 'saiu', { agora: dias(1) }).contato;
  assert.equal(s.optout, true); assert.equal(s.etapa, 'nao-quer');
  assert.deepEqual([s.whatsapp, s.telefone, s.email, s.responsavel], [null, null, null, null]);
  const r = p.importarLista(rg.id, [{ cnpj: '40000000000303', nome: 'OUTRO CNPJ MESMO CELULAR', whatsapp: '54988887777' }], { fonte: 'Receita' });
  assert.deepEqual([r.novos, r.bloqueados], [0, 1]);
  assert.equal(p.registrarContato({ regiaoId: rg.id, nome: 'Manual', whatsapp: '(54) 98888-7777' }).ok, false);
});

test('alertas de qualidade: DDD de fora da UF, e-mail repetido e só telefone fixo', () => {
  const rg = p.salvarRegiao({ nome: 'Campanha', uf: 'RS' }, { agora: D0 }).regiao;
  p.importarLista(rg.id, [{ cnpj: '50000000000101', nome: 'A', whatsapp: '61985495652', email: 'comercio@gmail.com' },
    { cnpj: '50000000000202', nome: 'B', whatsapp: '55999990000', email: 'comercio@gmail.com' },
    { cnpj: '50000000000303', nome: 'C', telefone: '5534223111' }], { fonte: 'Receita', agora: D0 });
  const cs = p.painel({ regiaoId: rg.id }).contatos;
  const al = (n) => cs.find((c) => c.nome === n).alertas.join(' | ');
  assert.match(al('A'), /DDD 61 é de fora de RS/); assert.match(al('A'), /e-mail repetido/);
  assert.doesNotMatch(al('B'), /DDD/);
  assert.match(al('C'), /só telefone fixo/);
});

test('balanço: funil, taxas, quem fecha e quem pode fechar; parcial até o fim do plano, final depois; sem "visualizaram"', () => {
  const b = p.balanco({ agora: dias(4) });
  assert.equal(b.final, false);
  assert.equal(b.plano.diaAtual, 5);
  assert.equal(b.visualizaram, null);
  assert.equal(b.fechados, 1); assert.equal(b.listaFechados.length, 1); assert.equal(b.listaFechados[0].nome, 'N5');
  assert.equal(b.contatados + b.naoContatados, b.base);
  assert.equal(b.pediramSair, 1);
  assert.ok(b.taxaResposta > 0 && b.taxaResposta <= 100);
  assert.ok(b.porRegiao.find((r) => r.nome === 'Norte de Minas (MG)').fechados === 1);
  assert.ok(b.enviosPorDia.length >= 1);
  const rg = p.painel().regioes.find((r) => r.nome === 'Campanha');
  const c = p.painel({ regiaoId: rg.id }).contatos.find((x) => x.nome === 'B');
  p.mover(c.id, 'contatado', { agora: D0 }); p.mover(c.id, 'respondeu', { agora: dias(1) });
  const b2 = p.balanco({ agora: dias(40) });
  assert.equal(b2.final, true, 'passou do fim do plano: resultado final');
  assert.ok(b2.listaPossiveis.some((x) => x.nome === 'B'), 'respondeu e não decidiu = pode fechar');
  const h = p.balancoHtml(b2, { loja: 'Bolso Cheio' });
  assert.match(h, /Balanço da prospecção/); assert.match(h, /Resultado final/); assert.match(h, /não informa leitura/);
});

test('fontes: cada lista mostra de onde veio, com o site oficial da Receita', () => {
  const f = p.painel().fontes;
  const rf = f.find((x) => /Receita Federal/.test(x.texto));
  assert.ok(rf && rf.n > 0);
  assert.equal(rf.nome, 'Receita Federal');
  assert.match(rf.url, /^https:\/\/dados\.gov\.br\//);
  assert.match(rf.arquivos, /^https:\/\/arquivos\.receitafederal\.gov\.br\//);
  assert.deepEqual(f.map((x) => x.n), [...f.map((x) => x.n)].sort((a, b) => b - a), 'a maior fonte primeiro');
});
