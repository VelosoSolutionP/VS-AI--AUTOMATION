/**
 * O login do QA-Gate contra uma SPA.
 *
 * O gate decidia "entrou" só pela URL ter mudado. SPA nao muda: troca a tela no
 * mesmo endereco. Resultado real observado no console da Veloso — login dava
 * certo, o dashboard aparecia, e o gate reprovava dizendo "login falhou",
 * deixando toda tela autenticada fora do alcance do gate.
 *
 * Testa em NAVEGADOR DE VERDADE contra um servidor local: um caminho SPA (sem
 * mudanca de URL) e um caminho classico (com redirect), pra correcao nao quebrar
 * quem ja funcionava.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { simulateFlows } from '../engine/core.mjs';

const SENHA = 'senha-de-teste-do-gate';

/**
 * SPA: a mesma URL serve login e dashboard; quem troca a tela é o JS, e a sessão
 * fica no localStorage — igual ao console da Veloso. Isso importa pro teste: o
 * fluxo navega DE NOVO pra rota depois de entrar, e uma SPA sem sessão guardada
 * voltaria pro login, escondendo o que está sendo medido aqui.
 */
const SPA = `<!doctype html><meta charset="utf-8"><body>
<div id="tela"></div>
<script>
const DENTRO='<nav id="menu">Visão geral</nav><ul><li class="item">Pedido 1</li></ul>';
const LOGIN='<input id="pass" type="password"><button id="ok">Entrar</button><div id="erro"></div>';
const tela=document.getElementById('tela');
function pintar(){
  if(sessionStorage.getItem('sessao')){tela.innerHTML=DENTRO;return;}
  tela.innerHTML=LOGIN;
  document.getElementById('ok').onclick=()=>{
    if(document.getElementById('pass').value!==${JSON.stringify(SENHA)}){
      document.getElementById('erro').textContent='Senha incorreta. Confira e tente de novo.';return;}
    sessionStorage.setItem('sessao','1');pintar();
  };
}
pintar();
</script></body>`;

/** Clássico: o POST do login redireciona pra outra rota. */
const CLASSICO = `<!doctype html><meta charset="utf-8"><body>
<form id="f"><input name="email"><input name="password" type="password">
<button type="submit">Entrar</button></form>
<script>document.getElementById('f').onsubmit=(e)=>{e.preventDefault();location.href='/painel';};</script></body>`;
const PAINEL = `<!doctype html><meta charset="utf-8"><body><nav id="menu">Visão geral</nav><ul><li class="item">Pedido 1</li></ul></body>`;

let srv, base;
test.before(async () => {
  srv = createServer((req, res) => {
    const rota = req.url.split('?')[0];
    const corpo = rota === '/painel' ? PAINEL : rota === '/classico' ? CLASSICO : SPA;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv.close());

const fluxo = { name: 'lista', path: '/app', mode: 'read', expectSelector: '.item', expectMinCount: 1, expectText: 'Visão geral' };

test('SPA: login sem mudar a URL é reconhecido via successSelector', async () => {
  const [r] = await simulateFlows({
    baseUrl: base,
    login: { path: '/app', emailSel: false, passSel: '#pass', submitSel: '#ok', password: SENHA, successSelector: '#menu', waitMs: 800 },
  }, [fluxo], { repo: 'spa-ok-' + Date.now() });
  assert.equal(r.status, 'green', r.errors?.join('; '));
});

test('SPA: senha errada continua reprovando — o sinal novo nao vira falso-verde', async () => {
  await assert.rejects(() => simulateFlows({
    baseUrl: base,
    login: { path: '/app', emailSel: false, passSel: '#pass', submitSel: '#ok', password: 'senha-errada-mesmo', successSelector: '#menu', waitMs: 800 },
  }, [fluxo], { repo: 'spa-ruim-' + Date.now() }), /login falhou/);
});

test('login classico (com redirect) continua passando sem successSelector', async () => {
  const [r] = await simulateFlows({
    baseUrl: base,
    login: { path: '/classico', emailSel: 'input[name=email]', email: 'a@b.c', passSel: 'input[name=password]', submitSel: 'button[type=submit]', password: SENHA, waitMs: 800 },
  }, [{ ...fluxo, path: '/painel' }], { repo: 'classico-' + Date.now() });
  assert.equal(r.status, 'green', r.errors?.join('; '));
});
