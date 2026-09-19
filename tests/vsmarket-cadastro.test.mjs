import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, cnpjValido, validarDocumento, mascarar, normalizarTelefone } from '../engine/vsmarket/documento.mjs';
import { normalizarPrestador, normalizarCliente, mudarStatus, podeMudarStatus, prestadorPublico, PARTICIPA_MATCHING } from '../engine/vsmarket/cadastro.mjs';
import { hashSenha, senhaConfere, validarSenha, normalizarUsuario, autenticar, publico, autorizado, sessaoValida } from '../engine/vsmarket/identidade.mjs';
import { registrar, verificar, ACOES } from '../engine/vsmarket/auditoria.mjs';
import { gerarCodigo, registrarIndicacao, converter, painel } from '../engine/vsmarket/indicacao.mjs';

/* ── documento ──────────────────────────────────────────────────────────── */

test('CPF e CNPJ conferidos pelo digito verificador', () => {
  assert.equal(cpfValido('111.444.777-35'), true);
  assert.equal(cpfValido('123.456.789-00'), false);
  assert.equal(cpfValido('111.111.111-11'), false, 'todos iguais passa na conta e é sempre invalido');
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.222.333/0001-99'), false);
});

test('validarDocumento diz QUAL tipo é — a modalidade do prestador depende disso', () => {
  assert.equal(validarDocumento('11144477735').tipo, 'CPF');
  assert.equal(validarDocumento('11222333000181').tipo, 'CNPJ');
  assert.match(validarDocumento('123').motivo, /11 dígitos \(CPF\) ou 14/);
});

test('documento é mascarado pra tela (§39)', () => {
  assert.equal(mascarar('11144477735'), '***.444.777-**');
  assert.ok(!mascarar('11144477735').includes('111'));
});

test('telefone vira formato canonico e recusa DDD invalido', () => {
  assert.equal(normalizarTelefone('(31) 98765-4321').telefone, '5531987654321');
  assert.equal(normalizarTelefone('+55 31 98765-4321').telefone, '5531987654321');
  assert.match(normalizarTelefone('98765-4321').motivo, /DDD/);
});

/* ── prestador ──────────────────────────────────────────────────────────── */

const base = { nome: 'Joao', documento: '11144477735', telefone: '31987654321', categorias: ['eletricista'], lat: -19.93, lng: -43.93, raioKm: 10 };

test('prestador novo NASCE pending — quem cadastra nao se aprova', () => {
  assert.equal(normalizarPrestador(base).prestador.status, 'PENDING');
  assert.ok(normalizarPrestador({ ...base, status: 'ACTIVE' }).erros.some((e) => /nasce PENDING/.test(e)));
});

test('so ACTIVE participa do matching', () => {
  assert.deepEqual(PARTICIPA_MATCHING, ['ACTIVE']);
});

test('sem categoria nao da pra casar com pedido nenhum', () => {
  assert.ok(normalizarPrestador({ ...base, categorias: [] }).erros.some((e) => /ao menos uma categoria/.test(e)));
});

test('o que falta pro pagamento vira AVISO, nao bloqueio de cadastro', () => {
  const r = normalizarPrestador(base);
  assert.deepEqual(r.erros, []);
  assert.ok(r.avisos.some((a) => /sem conta de recebimento/.test(a)));
  assert.ok(r.avisos.some((a) => /sem documentos anexados/.test(a)));
});

test('nao da pra pular UNDER_REVIEW: PENDING nao vai direto pra ACTIVE', () => {
  assert.equal(podeMudarStatus('PENDING', 'ACTIVE').ok, false);
  assert.equal(podeMudarStatus('PENDING', 'UNDER_REVIEW').ok, true);
  assert.equal(podeMudarStatus('UNDER_REVIEW', 'ACTIVE').ok, true);
});

test('BLOCKED é final — reverter exige decisao de gente, nao um clique', () => {
  assert.equal(podeMudarStatus('BLOCKED', 'ACTIVE').ok, false);
});

test('suspender ou bloquear EXIGE motivo registrado', () => {
  const p = normalizarPrestador(base).prestador;
  const ativo = { ...p, status: 'ACTIVE' };
  assert.match(mudarStatus(ativo, 'SUSPENDED', {}).erro, /exige motivo/);
  const r = mudarStatus(ativo, 'SUSPENDED', { motivo: 'reclamacoes repetidas', por: 'admin1' });
  assert.equal(r.erro, null);
  assert.equal(r.prestador.historicoStatus.at(-1).motivo, 'reclamacoes repetidas');
});

test('prestador publico nao carrega o documento completo', () => {
  const p = normalizarPrestador(base).prestador;
  assert.equal(p.documento, '11144477735', 'o registro interno guarda o documento');
  const pub = prestadorPublico(p);
  assert.equal(pub.documento, undefined, 'a forma publica NAO pode levar o documento');
  assert.equal(pub.documentoMascarado, '***.444.777-**', 'a tela usa o mascarado');
  assert.equal(pub.documentoTipo, 'CPF');
});

/* ── cliente ────────────────────────────────────────────────────────────── */

test('cliente exige aceite dos termos (§3 e base legal do §39)', () => {
  const r = normalizarCliente({ nome: 'Maria', telefone: '31999990000' });
  assert.ok(r.erros.some((e) => /aceite dos termos/.test(e)));
  assert.deepEqual(normalizarCliente({ nome: 'Maria', telefone: '31999990000', aceitouTermos: true }).erros, []);
});

test('cliente NAO exige documento — coleta minima; o gateway guarda isso', () => {
  const r = normalizarCliente({ nome: 'Maria', telefone: '31999990000', aceitouTermos: true });
  assert.equal(r.erros.length, 0);
  assert.equal(r.cliente.documento, undefined);
});

test('endereco do cliente sem coordenada é recusado com o numero do endereco', () => {
  const r = normalizarCliente({
    nome: 'M', telefone: '31999990000', aceitouTermos: true,
    enderecos: [{ logradouro: 'Rua A', cidade: 'BH', lat: -19.9, lng: -43.9 }, { logradouro: 'Rua B', cidade: 'BH' }],
  });
  assert.ok(r.erros.some((e) => /endereço 2/.test(e)));
});

/* ── identidade ─────────────────────────────────────────────────────────── */

test('senha usa sal diferente a cada hash — mesma senha, hash diferente', () => {
  const a = hashSenha('umaSenhaBoa123');
  const b = hashSenha('umaSenhaBoa123');
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.sal, b.sal);
  assert.equal(senhaConfere('umaSenhaBoa123', a.hash, a.sal), true);
  assert.equal(senhaConfere('umaSenhaBoa123', a.hash, b.sal), false, 'sal trocado nao pode validar');
});

test('senhaConfere nunca lanca, mesmo com lixo', () => {
  assert.equal(senhaConfere('x', null, null), false);
  assert.equal(senhaConfere(undefined, 'nao-hex', 'sal'), false);
});

test('politica de senha explica o que fazer, nao so "fraca"', () => {
  assert.ok(validarSenha('123').erros.some((e) => /10 caracteres/.test(e)));
  assert.ok(validarSenha('abcdefghijk').erros.some((e) => /número/.test(e)));
  assert.ok(validarSenha('senha1234567').erros.some((e) => /vazamento/.test(e)));
  assert.equal(validarSenha('umaSenhaBoa123').ok, true);
});

test('usuario publico NUNCA leva hash nem sal', () => {
  const { usuario } = normalizarUsuario({ email: 'a@b.com', nome: 'A', papel: 'admin', senha: 'umaSenhaBoa123' });
  const p = publico(usuario);
  assert.equal(p.hash, undefined);
  assert.equal(p.sal, undefined);
  assert.equal(p.email, 'a@b.com');
});

test('mesma mensagem pra e-mail inexistente e senha errada — senao entrega a lista de quem tem conta', () => {
  const { usuario } = normalizarUsuario({ email: 'a@b.com', nome: 'A', papel: 'cliente', senha: 'umaSenhaBoa123' });
  const semConta = autenticar(null, 'qualquer');
  const senhaErrada = autenticar(usuario, 'outraCoisa123');
  assert.equal(semConta.motivo, senhaErrada.motivo);
});

test('bloqueia depois de 5 tentativas', () => {
  let { usuario } = normalizarUsuario({ email: 'c@b.com', nome: 'C', papel: 'cliente', senha: 'umaSenhaBoa123' });
  for (let i = 0; i < 5; i++) { usuario = autenticar(usuario, 'errada').usuario; }
  const r = autenticar(usuario, 'umaSenhaBoa123');
  assert.equal(r.ok, false);
  assert.equal(r.bloqueado, true);
  assert.match(r.motivo, /muitas tentativas/);
});

test('papel interno exige MFA (§40)', () => {
  const { usuario } = normalizarUsuario({ email: 'ad@b.com', nome: 'Ad', papel: 'admin', senha: 'umaSenhaBoa123' });
  assert.equal(usuario.mfaObrigatorio, true);
  const r = autenticar(usuario, 'umaSenhaBoa123');
  assert.equal(r.ok, false);
  assert.equal(r.exigeMfa, true);
  const cliente = normalizarUsuario({ email: 'cl@b.com', nome: 'C', papel: 'cliente', senha: 'umaSenhaBoa123' }).usuario;
  assert.equal(cliente.mfaObrigatorio, false);
});

test('autorizacao é papel MAIS vinculo — papel sozinho nao basta', () => {
  const s = { usuarioId: 'u1', papel: 'prestador' };
  assert.equal(autorizado(s, { papeis: ['prestador'] }).ok, true);
  assert.equal(autorizado(s, { papeis: ['admin'] }).ok, false);
  assert.equal(autorizado(s, { papeis: ['prestador'], dono: 'u1' }).ok, true);
  assert.equal(autorizado(s, { papeis: ['prestador'], dono: 'u2' }).ok, false, 'nao pode ler recurso de outro');
});

test('sessao expirada é recusada com instrucao', () => {
  assert.match(sessaoValida({ expiraEm: '2020-01-01T00:00:00Z' }).motivo, /expirada/);
});

/* ── auditoria ──────────────────────────────────────────────────────────── */

test('auditoria recusa acao fora do catalogo e registro sem ator', () => {
  assert.match(registrar([], { ator: 'u1', acao: 'inventada' }).erro, /fora do catálogo/);
  assert.match(registrar([], { acao: ACOES[0] }).erro, /sem ator/);
});

test('a corrente detecta conteudo ALTERADO e aponta o registro', () => {
  let t = [];
  for (const a of ['cadastro.criado', 'prestador.status', 'pagamento.confirmado']) {
    t = [...t, registrar(t, { ator: 'u1', acao: a, entidade: 'x', entidadeId: '1' }).registro];
  }
  assert.equal(verificar(t).ok, true);
  const adulterada = t.map((r, i) => (i === 1 ? { ...r, ator: 'outro' } : r));
  const v = verificar(adulterada);
  assert.equal(v.ok, false);
  assert.equal(v.seq, 2);
  assert.match(v.motivo, /alterado depois de gravado/);
});

test('a corrente detecta registro REMOVIDO', () => {
  let t = [];
  for (let i = 0; i < 4; i++) { t = [...t, registrar(t, { ator: 'u1', acao: 'repasse' }).registro]; }
  const v = verificar([t[0], t[2], t[3]]);
  assert.equal(v.ok, false);
  assert.match(v.motivo, /remoção ou reordenação|sequência quebrada/);
});

/* ── indicacao ──────────────────────────────────────────────────────────── */

test('codigo de indicacao é legivel e nao colide', () => {
  assert.equal(gerarCodigo('João da Silva'), 'joaodasilva');
  assert.equal(gerarCodigo('João da Silva', ['joaodasilva']), 'joaodasilva2');
});

test('auto-indicacao é recusada (§38)', () => {
  const r = registrarIndicacao({ codigo: 'x', indicadorId: 'u1', indicadoId: 'u1' });
  assert.ok(r.erros.some((e) => /indicar a si mesmo/.test(e)));
});

test('a primeira indicacao vence — ninguem rouba indicado de outro', () => {
  const existente = [{ indicadoId: 'u2' }];
  const r = registrarIndicacao({ codigo: 'x', indicadorId: 'u1', indicadoId: 'u2' }, existente);
  assert.ok(r.erros.some((e) => /já foi indicada/.test(e)));
});

test('recompensa NASCE pendente de regra — §32 proibe inventar valor', () => {
  const { indicacao } = registrarIndicacao({ codigo: 'x', indicadorId: 'u1', indicadoId: 'u2' });
  assert.equal(indicacao.recompensaStatus, 'PENDENTE_DE_REGRA');
  assert.equal(indicacao.recompensaCentavos, null);
  assert.equal(painel([indicacao]).recompensa.definida, false);
});

test('converter duas vezes nao duplica', () => {
  const { indicacao } = registrarIndicacao({ codigo: 'x', indicadorId: 'u1', indicadoId: 'u2' });
  const a = converter(indicacao, 'cadastro');
  const b = converter(a.indicacao, 'primeiro_pedido');
  assert.equal(b.jaConvertida, true);
  assert.equal(b.indicacao.conversao, 'cadastro');
  assert.match(converter(indicacao, 'inventada').erro, /conversão desconhecida/);
});
