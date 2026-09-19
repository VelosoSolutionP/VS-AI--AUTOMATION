/**
 * VSmarket — geografia. Distância, raio de atendimento e cobertura.
 *
 * É a peça que decide QUEM pode ser chamado para um serviço, então errar aqui não é
 * erro de tela: é mandar um eletricista de Betim para um chamado em Sabará.
 *
 * Duas decisões que valem explicação:
 *
 *  1) Haversine, não Euclides. Diferença de latitude e longitude em graus NÃO é
 *     distância: um grau de longitude em BH vale ~104 km, um grau de latitude vale
 *     ~111 km. Calcular no plano encurta distâncias no sentido leste-oeste e faria o
 *     raio de atendimento mentir.
 *  2) Raio é o PISO da elegibilidade, não o teto. Bairro e cidade declarados contam
 *     mesmo fora do raio — o prestador que diz atender Contagem atende Contagem,
 *     ainda que a sede dele esteja a 30 km do ponto.
 *
 * Nada aqui depende de serviço externo: cálculo é local. Mapa é assunto da tela.
 */

/** Raio da Terra em metros (WGS-84, média). */
const R_TERRA = 6371008.8;

/** Região inicial do MVP — usada só para avisar quem está claramente fora. */
export const REGIAO_MVP = {
  nome: 'Belo Horizonte e Grande BH',
  centro: { lat: -19.9167, lng: -43.9345 },
  raioKm: 60,
};

/** Extremos continentais do Brasil — usados só para pegar lat/lng invertidas. */
export const BRASIL = { latMin: -33.75, latMax: 5.27, lngMin: -73.99, lngMax: -34.79 };

const rad = (g) => (g * Math.PI) / 180;

/** Coordenada válida? Fora da faixa não é "quase certo", é inválida. */
export function coordenadaValida(p) {
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { return false; }
  if (lat < -90 || lat > 90) { return false; }
  if (lng < -180 || lng > 180) { return false; }
  // (0,0) é o Golfo da Guiné. Em cadastro brasileiro isso é campo não preenchido.
  if (lat === 0 && lng === 0) { return false; }
  return true;
}

/** Valida e explica — a tela precisa dizer o que está errado, não só recusar. */
export function validarCoordenada(p) {
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, motivo: 'latitude e longitude são obrigatórias (números)' };
  }
  if (lat === 0 && lng === 0) {
    return { ok: false, motivo: 'coordenada (0,0) é o oceano — o campo não foi preenchido' };
  }
  if (lat < -90 || lat > 90) { return { ok: false, motivo: `latitude fora da faixa: ${lat}` }; }
  if (lng < -180 || lng > 180) { return { ok: false, motivo: `longitude fora da faixa: ${lng}` }; }
  // Erro clássico: inverter lat/lng no formulário. A deteccao so acusa quando CADA
  // valor cai na faixa DO OUTRO no Brasil — assim uma coordenada estrangeira legitima
  // nao e recusada por engano.
  //   latitude  brasileira: -33,75 a  5,27
  //   longitude brasileira: -73,99 a -34,79
  const pareceLat = lng >= BRASIL.latMin && lng <= BRASIL.latMax;
  const pareceLng = lat >= BRASIL.lngMin && lat <= BRASIL.lngMax;
  if (pareceLat && pareceLng) {
    return { ok: false, motivo: `latitude e longitude parecem trocadas (${lat}, ${lng}) — no Brasil a longitude é o número mais negativo` };
  }
  return { ok: true, coordenada: { lat, lng } };
}

/**
 * Distância em METROS entre dois pontos, pela fórmula de haversine.
 * Devolve null quando qualquer ponto é inválido — nunca 0, que significaria
 * "mesmo lugar" e colocaria o prestador no topo do ranking.
 */
export function distanciaMetros(a, b) {
  if (!coordenadaValida(a) || !coordenadaValida(b)) { return null; }
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRA * Math.asin(Math.sqrt(s));
}

export function distanciaKm(a, b) {
  const m = distanciaMetros(a, b);
  return m == null ? null : Number((m / 1000).toFixed(2));
}

/**
 * Caixa em volta de um ponto — serve para filtrar candidatos ANTES de calcular
 * haversine em todo mundo. Com banco, vira o índice; aqui já evita varrer a lista.
 */
export function caixa(centro, raioKm) {
  if (!coordenadaValida(centro) || !(raioKm > 0)) { return null; }
  const dLat = raioKm / 111.32;
  const cos = Math.cos(rad(centro.lat));
  // Perto dos polos o cosseno tende a zero e a caixa explodiria; no Brasil não
  // acontece, mas a guarda evita Infinity num dado sujo.
  const dLng = Math.abs(cos) < 1e-6 ? 180 : raioKm / (111.32 * cos);
  return {
    latMin: centro.lat - dLat, latMax: centro.lat + dLat,
    lngMin: centro.lng - dLng, lngMax: centro.lng + dLng,
  };
}

export function dentroDaCaixa(p, c) {
  if (!c || !coordenadaValida(p)) { return false; }
  return p.lat >= c.latMin && p.lat <= c.latMax && p.lng >= c.lngMin && p.lng <= c.lngMax;
}

const normalizar = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * O prestador atende este endereço?
 *
 * Três caminhos, e o motivo importa tanto quanto o resultado — o admin precisa saber
 * POR QUE alguém entrou ou ficou de fora do matching.
 *
 * @param {object} prestador {base:{lat,lng}, raioKm, cidades:[], bairros:[]}
 * @param {object} destino   {lat,lng,cidade,bairro}
 */
export function atende(prestador = {}, destino = {}) {
  const cidades = (prestador.cidades || []).map(normalizar);
  const bairros = (prestador.bairros || []).map(normalizar);

  // Bairro declarado é o mais específico: vence o raio.
  if (destino.bairro && bairros.includes(normalizar(destino.bairro))) {
    return { atende: true, motivo: 'bairro declarado na cobertura', criterio: 'bairro' };
  }
  if (destino.cidade && cidades.includes(normalizar(destino.cidade))) {
    return { atende: true, motivo: 'cidade declarada na cobertura', criterio: 'cidade' };
  }

  const d = distanciaKm(prestador.base, destino);
  if (d == null) {
    return { atende: false, motivo: 'sem coordenada válida do prestador ou do destino', criterio: null };
  }
  const raio = Number(prestador.raioKm);
  if (!(raio > 0)) {
    return { atende: false, motivo: 'prestador sem raio de atendimento definido', criterio: null, distanciaKm: d };
  }
  if (d <= raio) {
    return { atende: true, motivo: `${d} km, dentro do raio de ${raio} km`, criterio: 'raio', distanciaKm: d };
  }
  return { atende: false, motivo: `${d} km, fora do raio de ${raio} km`, criterio: null, distanciaKm: d };
}

/**
 * Ordena prestadores pela distância. Quem não tem coordenada vai para o FIM, não
 * para o começo — sem isso, `null` ordenaria como zero e o cadastro incompleto
 * apareceria primeiro.
 */
export function ordenarPorDistancia(prestadores = [], destino) {
  return prestadores
    .map((p) => ({ ...p, distanciaKm: distanciaKm(p.base, destino) }))
    .sort((a, b) => {
      if (a.distanciaKm == null && b.distanciaKm == null) { return 0; }
      if (a.distanciaKm == null) { return 1; }
      if (b.distanciaKm == null) { return -1; }
      return a.distanciaKm - b.distanciaKm;
    });
}

/** Está claramente fora da região do MVP? Avisa, não bloqueia (§1). */
export function foraDaRegiao(p) {
  const d = distanciaKm(REGIAO_MVP.centro, p);
  if (d == null) { return { fora: false, motivo: null }; }
  if (d > REGIAO_MVP.raioKm) {
    return { fora: true, distanciaKm: d, motivo: `${d} km do centro de BH — o MVP atende ${REGIAO_MVP.nome}` };
  }
  return { fora: false, distanciaKm: d, motivo: null };
}
