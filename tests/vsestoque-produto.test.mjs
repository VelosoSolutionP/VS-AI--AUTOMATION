import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarProduto, gtinValido, disponivel, disponibilidade, precoVigente, CONDICOES,
} from '../engine/vsestoque/produto.mjs';

const base = { nome: 'Camiseta Veloso', preco: 'R$ 79,90', quantidade: 10 };

test('produto valido normaliza com preco em centavos', () => {
  const { produto, erros } = normalizarProduto(base);
  assert.deepEqual(erros, []);
  assert.equal(produto.precoCentavos, 7990);
  assert.equal(produto.sku, 'camiseta-veloso', 'SKU sai do nome quando não vier');
  assert.equal(produto.condicao, 'novo');
  assert.equal(produto.moeda, 'BRL');
});

test('GTIN é validado pelo digito verificador, nao pelo tamanho', () => {
  assert.equal(gtinValido('7891234567895'), true);
  assert.equal(gtinValido('1234567890123'), false, 'tem 13 digitos mas o verificador nao fecha');
  assert.equal(gtinValido('789123456789'), false);
  assert.equal(gtinValido(''), false);
  assert.equal(gtinValido('40170725'), true, 'GTIN-8 valido');
});

test('GTIN errado é ERRO — feed com codigo inventado e reprovado sem dizer qual item', () => {
  const { erros } = normalizarProduto({ ...base, gtin: '1234567890123' });
  assert.ok(erros.some((e) => /dígito verificador/.test(e)));
});

test('preco promocional maior que o cheio é recusado', () => {
  const { erros } = normalizarProduto({ ...base, precoPromocional: 'R$ 99,90' });
  assert.ok(erros.some((e) => /MENOR que o preço cheio/.test(e)));
  assert.deepEqual(normalizarProduto({ ...base, precoPromocional: 'R$ 59,90' }).erros, []);
});

test('preco zero ou invalido nao passa', () => {
  assert.ok(normalizarProduto({ ...base, preco: 0 }).erros.some((e) => /maior que zero/.test(e)));
  assert.ok(normalizarProduto({ ...base, preco: 'de graça' }).erros.some((e) => /preço inválido/.test(e)));
});

test('nao da pra reservar mais do que existe', () => {
  const { erros } = normalizarProduto({ ...base, quantidade: 3, reservado: 5 });
  assert.ok(erros.some((e) => /não dá pra reservar 5 tendo 3/.test(e)));
});

test('quantidade fracionada ou negativa é erro', () => {
  assert.ok(normalizarProduto({ ...base, quantidade: 1.5 }).erros.some((e) => /inteiro >= 0/.test(e)));
  assert.ok(normalizarProduto({ ...base, quantidade: -2 }).erros.some((e) => /inteiro >= 0/.test(e)));
});

test('imagem precisa ser URL — caminho local nao serve pra feed', () => {
  const { erros } = normalizarProduto({ ...base, imagens: ['/home/veloso/foto.jpg'] });
  assert.ok(erros.some((e) => /URL http/.test(e)));
});

test('SKU repetido é erro — id duplicado faz o feed sobrescrever um com o outro', () => {
  const { erros } = normalizarProduto(base, { existentes: ['camiseta-veloso'] });
  assert.ok(erros.some((e) => /já existe produto com o SKU/.test(e)));
});

test('editar o proprio produto nao acusa SKU repetido', () => {
  const r = normalizarProduto({ ...base, sku: 'x1', skuOriginal: 'x1' }, { existentes: ['x1'] });
  assert.deepEqual(r.erros, []);
});

test('condicao desconhecida é recusada', () => {
  assert.ok(normalizarProduto({ ...base, condicao: 'seminovo' }).erros.some((e) => /condição desconhecida/.test(e)));
  for (const c of CONDICOES) { assert.deepEqual(normalizarProduto({ ...base, condicao: c }).erros, []); }
});

test('o que falta pro feed vira AVISO, nao bloqueia o cadastro', () => {
  const r = normalizarProduto(base);
  assert.deepEqual(r.erros, []);
  assert.ok(r.avisos.some((a) => /sem imagem/.test(a)));
  assert.ok(r.avisos.some((a) => /sem link/.test(a)));
  assert.ok(r.avisos.some((a) => /sem marca/.test(a)));
});

test('disponivel desconta o reservado e nunca fica negativo', () => {
  assert.equal(disponivel({ quantidade: 10, reservado: 4 }), 6);
  assert.equal(disponivel({ quantidade: 2, reservado: 5 }), 0);
  assert.equal(disponivel({}), null, 'sem quantidade é null, não 0');
});

test('disponibilidade é DERIVADA do saldo — nao da pra digitar "disponivel" sem ter', () => {
  assert.equal(disponibilidade({ quantidade: 5, reservado: 0 }), 'in_stock');
  assert.equal(disponibilidade({ quantidade: 5, reservado: 5 }), 'out_of_stock', 'tudo reservado = nao ha o que vender');
  assert.equal(disponibilidade({ quantidade: 5, ativo: false }), 'out_of_stock');
});

test('precoVigente usa o promocional so quando ele é menor', () => {
  assert.equal(precoVigente({ precoCentavos: 1000, precoPromocionalCentavos: 800 }), 800);
  assert.equal(precoVigente({ precoCentavos: 1000, precoPromocionalCentavos: null }), 1000);
  assert.equal(precoVigente({}), null);
});

test('variante ganha SKU derivado dos atributos', () => {
  const { produto } = normalizarProduto({
    ...base, sku: 'cam', variantes: [{ atributos: { cor: 'Preta', tamanho: 'M' }, quantidade: 3 }],
  });
  assert.equal(produto.variantes[0].sku, 'cam-preta-m');
  assert.equal(produto.variantes[0].quantidade, 3);
});
