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

test('regra do dono: e-mail no dia 0, WhatsApp (última tentativa) no dia 5; depois, esgotado', () => {
  const rg = p.painel().regioes[0];
  const c = p.registrarContato({ regiaoId: rg.id, nome: 'Loja A', whatsapp: '(33) 99999-0001' }, { agora: D0 }).contato;
  assert.equal(c.proximo.quando.slice(0, 10), '2026-10-03');
  assert.match(c.proximo.oque, /WhatsApp — última tentativa/);
  assert.equal(p.proximoToque(c, dias(4)).vencido, false);
  assert.equal(p.proximoToque(c, dias(5)).vencido, true);
  const t2 = p.mover(c.id, 'toque', { agora: dias(5) }).contato;
  assert.equal(t2.proximo.esgotado, true, 'depois do WhatsApp não se insiste');
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

test('WhatsApp: só depois do e-mail, com o texto do dono; depois dele, acabou', () => {
  const rg = p.salvarRegiao({ nome: 'Serra Gaúcha', uf: 'RS' }, { agora: D0 }).regiao;
  p.importarLista(rg.id, [{ cnpj: '40000000000101', nome: 'AGRO SERRA', segmento: 'Máquinas agrícolas | Peças', whatsapp: '54999990000', email: 'agro@serra.com' }], { fonte: 'Receita', agora: D0 });
  const achar = () => p.painel({ agora: D0, regiaoId: rg.id }).contatos.find((c) => c.cnpj === '40000000000101');
  let c = achar();
  assert.equal(c.wa, null, 'na lista: o 1º contato é o e-mail, não o WhatsApp');
  assert.equal(p.marcarEmailEnviado(c.id, { id: 'msg-1', agora: D0 }).ok, true);
  c = achar();
  assert.equal(c.etapa, 'contatado'); assert.equal(c.historico.at(-1).canal, 'email');
  assert.equal(c.wa.toque, 2);
  const t = decodeURIComponent(c.wa.url);
  assert.match(t, /^https:\/\/wa\.me\/5554999990000\?text=/);
  /* 02/10: texto direto — quem, por quê, de onde veio o contato; sem link de sair quando não há endereço público. */
  assert.match(t, /Aqui é o Fabiano, da Veloso Solution/);
  assert.match(t, /Estou falando com a AGRO SERRA porque temos o ZEST/);
  assert.match(t, /responda SAIR e tiramos seu contato da nossa base/);
  assert.match(t, /dados públicos de empresas da Receita Federal/);
  assert.doesNotMatch(t, /VDG|Você recebeu\?/);
  const comLink = decodeURIComponent(p.painel({ agora: D0, regiaoId: rg.id, origem: 'https://painel.exemplo' }).contatos.find((x) => x.id === c.id).wa.url);
  const link = /toque aqui e tiramos seu contato da nossa base: (https:\/\/painel\.exemplo\/sair\/(\S+))/.exec(comLink);
  assert.ok(link, 'com endereço público, o WhatsApp leva o link de sair');
  assert.deepEqual(p.contatoDoTokenSair(link[2]), { id: c.id, nome: 'AGRO SERRA', optout: false });
  assert.equal(p.contatoDoTokenSair(link[2].slice(0, -1) + (link[2].endsWith('A') ? 'B' : 'A')), null, 'token adulterado não vale');
  assert.equal(p.contatoDoTokenSair(`${c.id}.${'x'.repeat(22)}`), null, 'assinatura inventada não vale');
  p.mover(c.id, 'toque', { canal: 'whatsapp', agora: dias(5) });
  assert.equal(achar().wa, null, 'depois da última tentativa não tem outro WhatsApp');
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

test('e-mail do dia 0: modelo do dono com {EMPRESA} e saudação; lote em rodízio por região, sem e-mail repetido; conta o dia', () => {
  const modelo = 'ASSUNTO: Parceria para a {EMPRESA} — teste\n\n{Bom dia | Boa tarde}, equipe da {EMPRESA}!\n\nCorpo.\n\nANEXO: x.pdf\n';
  const manha = p.emailApresentacao({ nome: 'AGRO X' }, modelo, { agora: new Date('2026-09-28T12:00:00Z') });
  assert.equal(manha.assunto, 'Parceria para a AGRO X — teste');
  assert.match(manha.texto, /^Bom dia, equipe da AGRO X!/);
  assert.doesNotMatch(manha.texto, /ANEXO|ASSUNTO|\{/);
  assert.match(p.emailApresentacao({ nome: 'Y' }, modelo, { agora: new Date('2026-09-28T17:00:00Z') }).texto, /^Boa tarde/);
  assert.match(p.emailApresentacao({ nome: 'CNPJ 123' }, modelo).texto, /equipe da sua empresa/, 'sem nome na base: nunca "CNPJ 123"');
  const a = p.salvarRegiao({ nome: 'A', uf: 'AM' }, { agora: D0 }).regiao; const b = p.salvarRegiao({ nome: 'B', uf: 'RR' }, { agora: D0 }).regiao;
  p.importarLista(a.id, [1, 2, 3].map((i) => ({ cnpj: String(51000000000100 + i), nome: `AM${i}`, email: i === 3 ? 'contador@x.com.br' : `am${i}@x.com.br` })), { fonte: 'Receita', agora: D0 });
  p.importarLista(b.id, [1, 2].map((i) => ({ cnpj: String(52000000000100 + i), nome: `RR${i}`, email: i === 2 ? 'contador@x.com.br' : `rr${i}@x.com.br` })), { fonte: 'Receita', agora: D0 });
  const lote = p.loteEmail({ limite: 50 }).filter((c) => /^(AM|RR)\d$/.test(c.nome));
  const i1 = lote.findIndex((c) => c.nome === 'AM1'), i2 = lote.findIndex((c) => c.nome === 'RR1');
  assert.ok(i1 >= 0 && i2 >= 0 && Math.abs(i1 - i2) <= p.painel().regioes.length, 'rodízio: as duas regiões aparecem logo no começo do lote');
  assert.equal(lote.filter((c) => c.email === 'contador@x.com.br').length, 1, 'o mesmo e-mail não recebe duas vezes no lote');
  const antes = p.emailsHoje(D0);
  p.marcarEmailEnviado(lote[0].id, { agora: D0 });
  assert.equal(p.emailsHoje(D0), antes + 1);
  assert.equal(p.marcarEmailEnviado(lote[0].id, { agora: D0 }).ok, false, 'não marca duas vezes');
});

test('onda (29/09): porte da Receita no contato; com onda liberada só ela recebe; caixa que já recebeu não recebe de novo', () => {
  const r = p.salvarRegiao({ nome: 'Ondas', uf: 'MT' }, { agora: D0 }).regiao;
  p.importarLista(r.id, [1, 2, 3, 4].map((i) => ({ cnpj: String(53000000000100 + i), nome: `OND${i}`, email: i >= 3 ? 'mesma@loja.com.br' : `ond${i}@loja.com.br` })), { fonte: 'Receita', agora: D0 });
  const meus = p.paraOndas().filter((c) => String(c.cnpj).startsWith('53'));
  assert.equal(p.aplicarPorte(new Map([['53000000', { porte: 'ME', pf: false }]])).ok, true);
  assert.ok(p.paraOndas().filter((c) => String(c.cnpj).startsWith('53')).every((c) => c.porte === 'ME' && c.pessoaFisica === false), 'porte e pessoa física gravados — sem razão social/CPF');
  const ids = meus.filter((c) => c.email !== 'ond2@loja.com.br').map((c) => c.id);
  assert.equal(p.definirOnda({ numero: 1, nome: 'teste', criterio: 'x', ids, agora: D0 }).total, 3);
  const lote = p.loteEmail({ limite: 50 });
  assert.ok(lote.every((c) => ids.includes(c.id)), 'só a onda liberada entra no lote');
  assert.ok(!lote.some((c) => c.email === 'ond2@loja.com.br'), 'fora da onda não recebe');
  const mesma = lote.find((c) => c.email === 'mesma@loja.com.br');
  p.marcarEmailEnviado(mesma.id, { agora: D0 });
  assert.ok(!p.loteEmail({ limite: 50 }).some((c) => c.email === 'mesma@loja.com.br'), 'a filial com o mesmo e-mail não recebe num lote seguinte');
  const o = p.ondaAtual();
  assert.equal(o.numero, 1); assert.equal(o.enviados, 1);
});

test('"pediu pra sair" (29/09) vale pra toda empresa com o mesmo telefone ou e-mail — a filial ainda na lista não recebe', () => {
  const r = p.salvarRegiao({ nome: 'Filiais', uf: 'GO' }, { agora: D0 }).regiao;
  p.importarLista(r.id, [
    { cnpj: '71000000000101', nome: 'MATRIZ', whatsapp: '62999990001', email: 'matriz@x.com.br' },
    { cnpj: '71000000000202', nome: 'FILIAL', whatsapp: '62999990001', email: 'filial@x.com.br' },
    { cnpj: '72000000000101', nome: 'OUTRA', whatsapp: '62999990009', email: 'outra@x.com.br' },
  ], { fonte: 'Receita', agora: D0 });
  const [m, f, o] = ['71000000000101', '71000000000202', '72000000000101'].map((cnpj) => p.paraOndas().find((c) => c.cnpj === cnpj));
  p.mover(m.id, 'contatado', { agora: D0 });
  assert.equal(p.mover(m.id, 'saiu', { agora: D0 }).ok, true);
  const depois = (id) => p.paraOndas().find((c) => c.id === id);
  assert.equal(p.painel({ limite: 100 }).contatos.find((c) => c.id === f.id).whatsapp, null, 'mesmo WhatsApp: apagado da filial também');
  assert.equal(depois(f.id).email, 'filial@x.com.br', 'o e-mail da filial é outro — fica');
  assert.equal(depois(f.id).optout, false, 'a filial ainda tem contato próprio: não sai inteira');
  // sem contato próprio, sai inteira
  p.importarLista(r.id, [{ cnpj: '73000000000101', nome: 'SO O ZAP', whatsapp: '62999990077' }, { cnpj: '73000000000202', nome: 'SO O ZAP 2', whatsapp: '62999990077' }], { fonte: 'Receita', agora: D0 });
  const [z1, z2] = ['73000000000101', '73000000000202'].map((cnpj) => p.paraOndas().find((c) => c.cnpj === cnpj));
  p.mover(z1.id, 'saiu', { agora: D0 });
  assert.equal(depois(z2.id).optout, true, 'ficou sem contato nenhum: sai também');
  assert.equal(depois(o.id).optout, false, 'quem não divide contato fica');
});

test('bairro de BH (29/09): região com e-mail próprio; onda nova não tranca a anterior', () => {
  const r = p.salvarRegiao({ nome: 'Grande BH', uf: 'MG', modelo: 'email-bairro-bh.txt', anexo: 'portfolio-bairro.pdf' }, { agora: D0 }).regiao;
  assert.deepEqual(p.modeloDaRegiao(r.id), { modelo: 'email-bairro-bh.txt', anexo: 'portfolio-bairro.pdf' });
  assert.equal(p.salvarRegiao({ id: r.id, nome: 'Grande BH', uf: 'MG', modelo: '../../etc/passwd' }).regiao.modelo, null, 'só nome de arquivo .txt da pasta');
  assert.deepEqual(p.salvarRegiao({ id: r.id, nome: 'Grande BH', uf: 'MG', anexo: ['a.pdf', 'v.mp4', '../x.pdf'] }).regiao.anexo, ['a.pdf', 'v.mp4'], 'pdf e mp4, sem caminho');
  p.importarLista(r.id, [{ cnpj: '81000000000101', nome: 'LANCHE BOM', email: 'contato@lanchebom.com.br' }], { fonte: 'Receita', agora: D0 });
  const novo = p.paraOndas().find((c) => c.cnpj === '81000000000101');
  const antes = p.ondaAtual();
  assert.equal(p.definirOnda({ numero: antes.numero + 1, nome: 'bairro', criterio: 'x', ids: [novo.id], agora: D0 }).total, 1);
  const lote = p.loteEmail({ limite: 50 });
  assert.ok(lote.some((c) => c.id === novo.id), 'a onda nova recebe');
  assert.ok(lote.some((c) => c.onda === antes.numero), 'a anterior continua recebendo');
  assert.deepEqual(p.ondasLiberadas().map((o) => o.numero), [antes.numero, antes.numero + 1]);
});

test('parceiro por território (29/09): o e-mail diz o território e quantos possíveis clientes', () => {
  const r = p.salvarRegiao({ nome: 'Parceiros', uf: 'BR' }, { agora: D0 }).regiao;
  p.importarLista(r.id, [{ cnpj: '91000000000101', nome: 'SISTEMAS DO ZE', email: 'ze@sistemasdoze.com.br', oferta: { territorio: 'Virginópolis/MG (raio de 500 km)', clientes: '12.345', numero: 1 } }], { fonte: 'Receita', agora: D0 });
  const c = p.loteEmail({ limite: 5000 }).find((x) => x.cnpj === '91000000000101') || p.paraOndas().find((x) => x.cnpj === '91000000000101');
  const e = p.emailApresentacao({ ...c, nome: 'SISTEMAS DO ZE', oferta: { territorio: 'Virginópolis/MG (raio de 500 km)', clientes: '12.345' } }, 'ASSUNTO: Parceria para a {EMPRESA}\n\nEm {TERRITORIO} levantamos {CLIENTES} possíveis clientes.');
  assert.match(e.texto, /Em Virginópolis\/MG \(raio de 500 km\) levantamos 12\.345 possíveis clientes/);
  assert.match(p.emailApresentacao({ nome: 'X' }, '{TERRITORIO}: {CLIENTES}').texto, /a sua região: centenas de/);
});
