import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  distanciaKm, distanciaMetros, coordenadaValida, validarCoordenada,
  atende, ordenarPorDistancia, caixa, dentroDaCaixa, foraDaRegiao, REGIAO_MVP,
} from '../engine/vsmarket/geo.mjs';

const BH = { lat: -19.9245, lng: -43.9352 };      // centro
const SAVASSI = { lat: -19.9386, lng: -43.9336 };
const BETIM = { lat: -19.9678, lng: -44.1983 };

/* ── REGRA 0: o marketplace nao pode depender do Bolso Cheio ────────────── */

test('REGRA 0: nenhum arquivo do vsmarket importa de engine/vs* do VS-IA', () => {
  const dir = 'engine/vsmarket';
  const infratores = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const alvo = m[1];
      if (alvo.startsWith('node:') || alvo.startsWith('./')) { continue; }
      infratores.push(`${f} importa "${alvo}"`);
    }
  }
  assert.deepEqual(infratores, [], 'o marketplace deve ser independente — ver regra 0 da spec');
});

/* ── distancia ──────────────────────────────────────────────────────────── */

test('haversine bate com a distancia real entre pontos conhecidos de BH', () => {
  // centro -> Savassi: ~1,6 km; centro -> Betim: ~28 km
  const d1 = distanciaKm(BH, SAVASSI);
  assert.ok(d1 > 1.4 && d1 < 1.8, `esperado ~1,6 km, veio ${d1}`);
  const d2 = distanciaKm(BH, BETIM);
  assert.ok(d2 > 26 && d2 < 30, `esperado ~28 km, veio ${d2}`);
});

test('distancia é simetrica e zero no mesmo ponto', () => {
  assert.equal(distanciaKm(BH, SAVASSI), distanciaKm(SAVASSI, BH));
  assert.equal(distanciaMetros(BH, BH), 0);
});

test('calcular no plano encurtaria a distancia leste-oeste — haversine nao', () => {
  // dois pontos com a MESMA diferenca em graus, um em latitude e outro em longitude
  const norte = { lat: BH.lat + 0.1, lng: BH.lng };
  const leste = { lat: BH.lat, lng: BH.lng + 0.1 };
  const dN = distanciaKm(BH, norte);
  const dL = distanciaKm(BH, leste);
  assert.ok(dN > dL, 'um grau de latitude vale mais que um de longitude nesta latitude');
  assert.ok(dN - dL > 0.5, `a diferenca precisa ser real: ${dN} vs ${dL}`);
});

test('coordenada invalida devolve null, NUNCA 0 — zero viraria "mesmo lugar"', () => {
  assert.equal(distanciaKm(BH, null), null);
  assert.equal(distanciaKm(BH, { lat: 'x', lng: 'y' }), null);
  assert.equal(distanciaKm(BH, { lat: 0, lng: 0 }), null);
});

/* ── validacao ──────────────────────────────────────────────────────────── */

test('(0,0) é campo nao preenchido, nao o Golfo da Guine', () => {
  assert.equal(coordenadaValida({ lat: 0, lng: 0 }), false);
  assert.match(validarCoordenada({ lat: 0, lng: 0 }).motivo, /não foi preenchido/);
});

test('fora da faixa é recusado com o valor no motivo', () => {
  assert.match(validarCoordenada({ lat: 95, lng: -43 }).motivo, /latitude fora da faixa: 95/);
  assert.match(validarCoordenada({ lat: -19, lng: 200 }).motivo, /longitude fora da faixa: 200/);
});

test('lat/lng trocadas sao detectadas SEM recusar coordenada estrangeira legitima', () => {
  assert.equal(validarCoordenada({ lat: -43.9345, lng: -19.9167 }).ok, false, 'BH trocado tem que cair');
  assert.match(validarCoordenada({ lat: -43.9345, lng: -19.9167 }).motivo, /parecem trocadas/);
  // essas sao validas e nao podem ser recusadas por engano
  for (const [nome, c] of [
    ['BH', { lat: -19.9167, lng: -43.9345 }],
    ['Buenos Aires', { lat: -34.60, lng: -58.38 }],
    ['Cidade do Cabo', { lat: -33.92, lng: 18.42 }],
    ['Lisboa', { lat: 38.72, lng: -9.14 }],
  ]) {
    assert.equal(validarCoordenada(c).ok, true, `${nome} foi recusada por engano`);
  }
});

/* ── cobertura ──────────────────────────────────────────────────────────── */

const prestador = (extra = {}) => ({ base: SAVASSI, raioKm: 10, cidades: [], bairros: [], ...extra });

test('dentro do raio atende, e o motivo traz a distancia', () => {
  const r = atende(prestador(), BH);
  assert.equal(r.atende, true);
  assert.equal(r.criterio, 'raio');
  assert.match(r.motivo, /dentro do raio de 10 km/);
});

test('fora do raio nao atende, e o motivo diz quanto faltou', () => {
  const r = atende(prestador({ raioKm: 1 }), BH);
  assert.equal(r.atende, false);
  assert.match(r.motivo, /fora do raio de 1 km/);
});

test('cidade declarada VENCE o raio — quem diz atender Contagem, atende', () => {
  const r = atende(prestador({ base: BETIM, raioKm: 1, cidades: ['Belo Horizonte'] }), { ...BH, cidade: 'Belo Horizonte' });
  assert.equal(r.atende, true);
  assert.equal(r.criterio, 'cidade');
});

test('bairro é mais especifico que cidade e tambem vence o raio', () => {
  const r = atende(prestador({ raioKm: 1, bairros: ['Savassi'] }), { ...BH, bairro: 'savassi' });
  assert.equal(r.criterio, 'bairro');
});

test('acento e caixa nao podem quebrar a cobertura', () => {
  const p = prestador({ raioKm: 1, cidades: ['Belo Horizonte'] });
  for (const cidade of ['BELO HORIZONTE', 'belo horizonte', 'Belo Horizonte ']) {
    assert.equal(atende(p, { ...BH, cidade }).atende, true, `falhou com "${cidade}"`);
  }
  assert.equal(atende(prestador({ raioKm: 1, bairros: ['Funcionários'] }), { ...BH, bairro: 'funcionarios' }).atende, true);
});

test('prestador sem raio definido nao entra por engano', () => {
  const r = atende(prestador({ raioKm: 0 }), BH);
  assert.equal(r.atende, false);
  assert.match(r.motivo, /sem raio de atendimento/);
});

test('sem coordenada valida o motivo diz isso, em vez de "fora do raio"', () => {
  assert.match(atende(prestador({ base: null }), BH).motivo, /sem coordenada válida/);
});

/* ── ordenacao e caixa ──────────────────────────────────────────────────── */

test('quem nao tem coordenada vai pro FIM, nao pro comeco', () => {
  const r = ordenarPorDistancia([
    { id: 'longe', base: BETIM },
    { id: 'sem', base: null },
    { id: 'perto', base: SAVASSI },
  ], BH);
  assert.deepEqual(r.map((x) => x.id), ['perto', 'longe', 'sem']);
});

test('a caixa contem o proprio centro e exclui quem esta claramente fora', () => {
  const c = caixa(BH, 5);
  assert.equal(dentroDaCaixa(BH, c), true);
  assert.equal(dentroDaCaixa(SAVASSI, c), true);
  assert.equal(dentroDaCaixa(BETIM, c), false);
});

test('caixa recusa entrada invalida em vez de devolver Infinity', () => {
  assert.equal(caixa(BH, 0), null);
  assert.equal(caixa({ lat: 0, lng: 0 }, 5), null);
});

test('fora da regiao do MVP avisa, com a distancia', () => {
  const r = foraDaRegiao({ lat: -23.55, lng: -46.63 }); // Sao Paulo
  assert.equal(r.fora, true);
  assert.match(r.motivo, new RegExp(`o MVP atende ${REGIAO_MVP.nome}`));
  assert.equal(foraDaRegiao(SAVASSI).fora, false);
});
