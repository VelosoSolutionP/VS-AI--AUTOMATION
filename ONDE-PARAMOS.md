# Onde paramos — 23/09/2026, madrugada

Documento de retomada. Lê de cima pra baixo quando voltar; o que importa está nas
duas primeiras seções.

---

## 1. Estado de produção agora

| | |
|---|---|
| Painel | `:8787` — `painel.velososolution.com.br` |
| WhatsApp | conectado, `553175536010`, sessão salva (reconecta sem QR) |
| Fluxo no ar | **o seu, 40 passos** (Veloso) |
| Vitrine pública | vazia |
| Pagamento | Mercado Pago, **PRODUÇÃO**, pronto |
| Demo | `:8790` — `demo.velososolution.com.br`, instalação separada |

Nada do Juarez está ativo. Pode dormir tranquilo.

---

## 2. O que passou a funcionar hoje

**Pagamento online, de ponta a ponta.** Antes não saía cobrança nenhuma pelo
Mercado Pago. Três defeitos em série, todos calados:

1. O diagnóstico conferia chave do **Asaas** mesmo com o Mercado Pago escolhido —
   toda cobrança era recusada pedindo credencial de um gateway fora de uso, e não
   havia como sair disso configurando o MP.
2. `cobrar()` lia a resposta só no formato do Asaas. O MP responde em outro
   formato, então a cobrança nascia **sem id e sem link, com `ok: true`**.
3. Em ambiente de teste o link tem de ser o de **sandbox**. O de produção recusa
   preferência criada com chave de teste e devolve uma página de erro — que
   responde **HTTP 200**. Conferir o status dizia que estava tudo bem.

**Pix direto funciona na sua conta de produção.** O QR nasce aqui, com o seu nome.
Isso significa que a Micaela manda o **QR como imagem dentro da conversa** — o
cliente não sai do WhatsApp. Já implementado e testado.

**O sistema agora diz de quem é cada chave.** As duas do Mercado Pago começam com
`APP_USR-`; o que separa é a conta. Conferido: **suas duas chaves estão nos campos
certos**. Nada trocado.

**Webhook `order.processed` parou de dar 401.** O `data.id` alfanumérico vai em
minúsculas no manifesto, e campo ausente sai do gabarito. Provado por HTTP:
assinatura válida → 200, inválida → 401.

---

## 3. O beco do ambiente de teste do Mercado Pago

**Não insista nele.** Os dois caminhos estão mortos do lado deles:

- Conta de teste **não registra chave Pix** → `/v1/payments` responde 401. Não há
  onde cadastrar.
- Checkout de sandbox devolve *"Hubo un error accediendo a esta pagina"* mesmo com
  comprador de teste criado pela API deles. Verificado no navegador.

Testar recebimento exige **produção**. Se quiser sem custo, tem
`node scripts/estornar.mjs <id>` — ele mostra o que vai devolver e exige SIM
digitado.

---

## 4. Juarez Tele-Entrega — congelado, pronto pra voltar

Tudo guardado em `exemplos/`:

- `fluxo-juarez-tele-entrega.csv` — 13 passos, cardápio por SKU, **um único**
  encaminhamento pra gente (bairro fora da área)
- `catalogo-juarez.mjs` — 5 produtos, semeador idempotente

**Pra descongelar:**

```bash
VS_HOME=~/.qa-gate node exemplos/catalogo-juarez.mjs
# carregar o CSV pelo painel (Bot → Fluxo de atendimento → escolher arquivo)
bash backend/reiniciar-painel.sh 8787
```

**Pra voltar ao seu fluxo depois:**

```bash
cp ~/.qa-gate/vsbot/fluxo.veloso-40passos-202609222305.json ~/.qa-gate/vsbot/fluxo.json
```

**Vídeo pro comercial:** `video-venda/juarez-pedido-e-pagamento.mp4` — 1m11s.
Catálogo → árvore → pedido inteiro → Total e link na tela. Nada encenado.

---

## 5. O teste que ficou por fazer

Fechar o ciclo: **pagar uma cobrança e ver o aviso chegar**.

```bash
cd ~/Veloso/VelosoSolution/VS-IA
set -a; . ~/.qa-gate/console/painel.env; set +a
node scripts/testar-recebimento.mjs      # R$ 1,00, ou VALOR_CENTAVOS=1 pra um centavo
```

Paga e confere:

```bash
tail -20 .painel.log | grep -iE "mercadopago|caixa"
```

- **Aparece o id com `CONFIRMADO`/`DISPONIVEL`** → ciclo completo, incluindo
  lançamento no caixa.
- **Não aparece nada** → o dinheiro caiu igual, mas o MP não está avisando aqui.
  Aí é a **assinatura secreta** no painel deles que falta.

Já existem 4 cobranças de R$ 1,00 criadas e não pagas — `pending` dos dois lados.
Podem ser ignoradas.

---

## 6. Pendências reais

**Do lado do Mercado Pago (cliques seus):**

1. `MP_WEBHOOK_SECRET_TESTE` e `MP_WEBHOOK_SECRET_PRODUCAO` não existem — só o
   `MP_WEBHOOK_SECRET` único. O MP gera **um por ambiente**; usar o errado dá 401
   em pagamento real: o dinheiro entra na conta e nunca vira lançamento aqui.
   Painel → sua aplicação → Webhooks → assinatura secreta de cada modo.
2. `VS_URL_WEBHOOK_PAGAMENTO` não está definida. As rotas existem:
   `/api/webhooks/mercadopago/producao` e `/teste`.

**Do lado do produto:**

3. Evento de **Order** (API nova do Mercado Livre) responde 200 mas **não é
   processado** — só tratamos evento de `payment`. Importa quando for ligar pedido
   de marketplace virando lançamento.
4. Não existe **tela de pagamentos** no painel. A cobrança só aparece na conversa.
5. O fluxo Veloso de 40 passos **não tem passo de preço** — "quanto custa" cai no
   menu.

**Segurança, adiado de comum acordo:** token sem cifra em repouso, ausência de
RBAC, sem rotina de exclusão de dados a pedido.

---

## 7. Armadilhas descobertas — não repetir

**Variável apontando pra pasta temporária.** Um `VSESTOQUE_DIR=/tmp/claude-.../est2`
de uma sessão antiga ficou no ambiente do painel. O `reiniciar-painel.sh` herda o
ambiente do processo anterior, então isso se propagou em **todo restart**: o painel
lia o estoque de uma pasta com um produto chamado "teste", e no WhatsApp todo item
do cardápio aparecia como *indisponível*. Nada na tela apontava pra isso — catálogo,
fluxo e SKUs estavam todos certos.

Consertado nos dois lados: o script descarta variáveis que apontem pra
`/tmp/claude-*`, e o canal registra **quantos produtos** a Micaela enxergou em cada
mensagem. Foi essa linha que resolveu em um segundo:

```
[canais] catalogo visto nesta mensagem: 1 produto(s) — teste
```

**HTTP 200 não quer dizer que funcionou.** A página de erro do Mercado Pago responde
200. Se a prova for "deu 200", não é prova. Este caso custou várias horas — nossas e
suas.

**Protocolo aberto sequestra a conversa.** Um atendimento em aberto na fila faz o
"oi" seguinte cair na retomada em vez de começar o fluxo, por 24h. Limpar:
`bot.devolverAoBot(<id>)` + `proto.apagarDe(<id>)`.

**Reiniciar o painel não custa mais pareamento.** A sessão do WhatsApp está salva e
reconecta sem QR — verificado quatro vezes hoje. Leva ~10 segundos, e nesse
intervalo a tela mostra o estado anterior; trocar foto agora espera o canal voltar
em vez de dar erro.

---

## 8. Paulão — o que falta decidir

Não existe nada dele no projeto: nem fluxo, nem CSV, nem configuração.

**O ponto de arquitetura:** hoje o sistema tem **um canal e um fluxo só**. Se o
Paulão atende os clientes da Dra Daynne, ele não pode dividir a instalação com você
— trocar o fluxo dele derrubaria o seu. O caminho que já existe e funciona é o da
demo: **outra instalação**, outra pasta de dados, outra porta, outro número pareado.
Seria um `subir-cliente.sh`.

**Três respostas destravam:**

1. Qual **número** de WhatsApp o Paulão atende (ou se ainda não tem)
2. **O que ele faz** — triagem de caso, agendamento, status de processo
3. **Se cobra** — consulta, honorário inicial. Se cobrar, já nasce com Pix.

Um texto solto descrevendo como a Dra Daynne atende hoje é suficiente: foi assim que
o Juarez saiu do zero.

---

## 9. Produto novo que você desenhou hoje (não começado)

Anotado pra não se perder. Não é fluxo de bot — é produto de controle em cima das
plataformas de entrega:

- Repasse pro entregador: número do pedido, valor, forma de pagamento
- Só libera o entregador pra outro cliente quando finalizar; 5 min de prazo, senão
  o sistema finaliza sozinho
- Monitoramento de atraso, com a multa da plataforma repassada ao entregador quando
  a culpa for apurada
- Rastreio da entrega
- Ponte e controle sobre 99, Zedelivery, Mercado Livre, Shopee, AliExpress
- **Auditor** — a parte que mostra ao lojista as falhas, atrasos e prejuízo
- Validação de cadastro do restaurante nessas plataformas; sem venda avulsa

Merece desenho próprio.

---

## Commits de hoje

| | |
|---|---|
| `6c9cb2c` | a tela do bot para de dizer que ele não faz nada |
| `97e9612` | o cliente fecha o pedido e paga sem falar com ninguém |
| `baf9c00` | a Mica vende do catálogo, e o sistema diz de quem é cada chave |
| `63fccc7` | virar pra produção deixa de ser aposta |
| `d3cac22` | `order.processed` parava em 401 por causa de uma letra maiúscula |
| `9058e03` | a cobrança passa pelo caminho do produto, não pelo atalho |
| `716b042` | estorno, pra testar recebimento sem perder dinheiro |
| `4f82b36` | número do pedido e o Pix copia-e-cola vão na conversa |
| `22148d6` | o QR chega como imagem na conversa |
| `0d40a94` | trocar a foto durante a reconexão para de dar erro |
| `6428c87` | atualizar preço não exige mais desconectar e conectar |
| `d4573a8` | pasta temporária para de virar casa de dado do painel |

Branch `fix/fabiano.veloso/6458`, tudo com push feito.

**O QA-Gate não rodou verde em nenhum momento** — ele pula por falta de
`qa-gate.config.json` no repositório, então não existe recibo. O que está provado é
o que os testes mostram.
