# Mapa mental do Bolso Cheio (VS-IA)

> **Pra que serve este arquivo:** quando o QA reclamar de uma tela ou o dev pedir pra analisar um bug, comece por aqui. Ele diz **pra que cada tela serve, o que tem nela, onde está o código** e **quais regras foram decididas pelo dono** — pra que um "conserto" não desfaça uma decisão de negócio.
>
> **Regra:** todo pedido novo do dono entra no [Histórico de pedidos](#histórico-de-pedidos) e, se mexer numa tela, a seção da tela é atualizada no mesmo commit.
>
> Dono / tech lead: Fabiano Veloso (dev + tech lead enquanto a equipe está de férias). Decisão de negócio ou impedimento → falar com ele.

---

## Como localizar um bug (roteiro de 5 minutos)

1. **Ache a tela.** O endereço termina em `#id-da-tela` (ex.: `…/crm#tg-resultados`). Procure esse id na seção [Telas](#telas) abaixo.
2. **Ache o código da tela.** Tudo do console está em **um arquivo só**: `backend/crm.html`. Busque o nome indicado em "Código da tela" (ex.: `telaResultados(`).
3. **Ache a ação.** O botão chama uma função JS (coluna "Ações"). Ela chama `api('rota', dados)` → vira `POST/GET /crm/api/rota`.
4. **Ache a rota no servidor.** `backend/server.mjs`, busque `'/crm/api/rota'`. A rota chama um módulo em `engine/` ou `backend/`.
5. **Veja o log.** `tail -f .painel.log` (na raiz do projeto). Cada canal escreve com prefixo: `[canais]`, `[telegram]`, `[pagamento]`, `[pix]`, `[seguranca]`, `[acesso]`.
6. **Reproduza com teste.** `node --test tests/<modulo>.test.mjs`. Os testes rodam isolados (`VS_HOME` numa pasta temporária) — nunca tocam dados de produção.
7. **Depois de mexer no servidor:** `bash backend/reiniciar-painel.sh` (mantém as variáveis do `painel.env`). Mudança só no `crm.html` **não precisa reiniciar** — o servidor relê o arquivo a cada acesso.

**Erros que já apareceram e o que eram:**
| Sintoma | Causa real |
|---|---|
| Bot diz "vou chamar um vendedor" mas a conversa não aparece na fila e o bot segue respondendo | Loja **só com regras** (sem fluxo): o caminho das regras não gravava a transferência nem respeitava o silêncio. Corrigido no fim de `atender()` (`engine/vsbot`). Achado pelo teste de volume. |
| Bot "não respondeu" a segunda pergunta igual | Proposital: o canal não repete a MESMA frase pra mesma pessoa em 5 min (`jaDisseAgora` em `backend/canais.mjs`). |
| Painel lateral não aparece no celular (só o fundo escurece) | Era `<aside>`: o CSS do menu lateral vale pra todo `aside` e no celular desliza pra fora da tela. Painel é `<div class="gaveta">`. |
| Tela abre sem o menu lateral | Página ficou com a classe `sem-nav` do login. Trocar o `#` com o login aberto não desenha mais tela (guarda no `hashchange`). |
| Elemento que devia sumir fica aparecendo (caixa vazia) | CSS com `display:` anula o atributo `hidden`. Precisa de `.x[hidden]{display:none}` (já corrigido em `.pill` e `.g-dica`). |
| Volta pro login no meio do teste automatizado | Limite de 300 pedidos/minuto (`LIM_CRM`) estourado pelo robô. Uso normal não chega nisso. |
| Painel fora do ar depois de reiniciar a máquina | O painel **não é serviço do sistema** (o site e o túnel são). Subir com `bash backend/reiniciar-painel.sh` — se nada estiver rodando, subir do zero carregando `~/.qa-gate/console/painel.env`. |
| Login do dono cai em "Minha conta" / tela de compra | Corrigido: e-mail do dono entra como dono com qualquer uma das duas senhas (ver Decisões). |

---

## Teste de volume do atendimento (Telegram)

`node scripts/teste-volume-telegram.mjs [funcional|concorrencia|carga] [--tela foto.png] [--json saida.json] [--manter]`

- Sobe uma **instância isolada** do painel (pasta de dados temporária, `HOME`/`VS_HOME` nela, ambiente limpo sem credencial nenhuma, escuta só em `127.0.0.1`) e um **Telegram falso** local. As mensagens simuladas passam pelo **caminho real**: provider Telegram → gateway → atendimento → bot → CRM → fila. Nada toca produção; nenhuma rota pública aceita mensagem falsa.
- **Ao vivo** (`--ao-vivo [--intervalo 2000]`): abre o console da instância de teste no navegador (link direto `?t=`), manda os clientes **um a um** e, no fim, **deixa tudo no ar e na tela** (instância + Telegram falso ficam rodando como servidores; dá pra clicar, assumir, responder). Desligar: `node scripts/teste-volume-telegram.mjs --parar` (a pasta de dados fica). Roda em primeiro plano — o gancho de governança proíbe processo em segundo plano.
- Cenários: **funcional** 5 clientes (3 aguardando · 1 com vendedor · 1 com o bot) · **concorrência** 30 (20 · 5 · 5) · **carga** 200 (120 · 40 · 40).
- Confere: todo cliente respondido, reentrega do mesmo update sem resposta dupla, resposta certa por tipo, bot quieto com quem pediu gente ou foi assumido, bot respondendo quem está com ele, contagem da fila no CRM, uma conversa por cliente, **históricos sem mistura**, marcos de transferência/assunção, zero erro no servidor. Mede latência (p50/p95/máx), tempo até a fila ficar certa e memória.
- Só para o teste existem as variáveis `TELEGRAM_API_URL` (`backend/canais.mjs`) e `HOST` (`backend/server.mjs`); em produção nenhuma é definida.
- Resultado em 2026-09-27: **3 cenários passando**. 30 clientes → resposta p50 ~150 ms / p95 ~260 ms, fila certa em ~70 ms, pico ~90 MB. 200 clientes → p50 ~1,4 s / p95 ~3 s, fila certa em ~210 ms, pico ~116 MB.

---

## Arquitetura em uma página

```
Navegador ──► Cloudflare (túnel) ──► 127.0.0.1:8787  backend/server.mjs  (painel "Bolso Cheio")
                                     127.0.0.1:8790  instância de DEMONSTRAÇÃO (backend/subir-demo.sh)
                                     127.0.0.1:3000  site institucional (outro projeto: ../Site)

backend/crm.html ........ o console inteiro (HTML + CSS + JS num arquivo)
backend/server.mjs ...... todas as rotas /crm/api/*, /vitrine, /webhook
backend/canais.mjs ...... onde o canal encontra o domínio (monta o gateway e os providers)
engine/canais/
  gateway.mjs ........... fronteira: recebe mensagem canônica, trava reentrega, responde pelo mesmo canal
  provider.mjs .......... CONTRATO de todo canal (conectar, enviar, receber, status…)
  whatsapp-web/ ......... provider WhatsApp Web (QR code)
  telegram/ ............. provider Telegram (Bot API, long polling)
backend/atendimento.mjs . a mensagem vira lead, passa pelo bot, gera cobrança e pedido
engine/vsbot/ ........... o bot (regras, fluxo em planilha, emergência, moderação) — funções puras
engine/vscrm/ ........... leads, funil, trilha de interações
engine/vsresultados/ .... pedidos atribuídos por canal, campanhas, oportunidades de retomada
engine/vscampanhas/ ..... campanha do Telegram: conteúdo, auditor por regras (por versão), aprovação → link
engine/vsqualificacao/ .. ficha comercial do lead, matriz de encaminhamento, rodízio (WhatsApp + Telegram, sem IA)
engine/vspagamentos/ .... Mercado Pago / Asaas, estados do pagamento
engine/vsestoque/ ....... catálogo, vitrine, feeds (Google, Meta, TikTok)
backend/usuarios.mjs .... login, sessões, convites (dono × cliente × vendedor)
```

**Onde ficam os dados (produção):** `~/.qa-gate/` (a "casa"). Ex.: `console/` (usuários, sessões, `painel.env`), `canais/` (config, `telegram.json` com o token — permissão 600), `vsresultados/`, `vspagamentos/`, `vsestoque/`. A demo usa outra casa: `~/.qa-gate-demo`.
**⚠ A sessão do WhatsApp NÃO mora na casa:** fica em `VS-IA/tokens/<WPP_SESSAO>` (produção = `tokens/veloso`, demo = `tokens/demo`). Por isso a demo sobe com `WPP_SESSAO=demo` e, em `DEMO=1`, `backend/canais.mjs` (`bloqueioDemo`) recusa a sessão `veloso` e o bot do Telegram da produção (compara com `~/.qa-gate/canais/telegram.json`, ou `VS_HOME_PRODUCAO`).

**Endereços públicos:** `bolsocheio.velososolution.com.br` (console) · `painel.velososolution.com.br` (endereço antigo, mesmo painel — não tirar: está cadastrado na TikTok) · `demo.velososolution.com.br` (demonstração) · `velososolution.com.br` (site).

---

## Sistema visual e avisos (regras do console)

- **Tema padrão: escuro "Navy + Violeta + Esmeralda".** Superfícies (fundo, menu, cartões, avisos) em azul-marinho neutro; **violeta só na marca e na ação** (botão principal, item ativo, foco); **esmeralda no dinheiro e no sucesso**. O tema claro continua no botão Claro/Escuro. Tokens em `:root[data-theme="dark"]` no `crm.html`. Decidido pelo dono em 2026-09-26 (proposta de paleta dele).
- **Ícone de cartão é só o ícone** — sem caixinha, fundo nem brilho (a caixinha parecia botão e não era).
- **Avisos:** `flash(texto,'ok'|'err')`, `avisoOk(titulo,html)`, `avisoErro(titulo,html,motivos,acao)` → cartão no canto (função `toast`). **Todo aviso some sozinho** (decisão do dono, 2026-09-27): sucesso em 4–10 s, **erro em 10–20 s** conforme o tamanho; mouse em cima pausa; × fecha na hora. O fechamento é por **relógio** (`setTimeout`), não pela animação — com "reduzir animações" ligado a barrinha some e o aviso ficava pra sempre. Só `op.fixo:true` fica. Aviso repetido não empilha. Com modal aberto, o aviso sobe pro topo (não tapa o Salvar). **Nunca usar modal pra dar recado** — erro em modal apagava o formulário aberto.
- **Confirmação** (`confirmar({...})`): caixa pequena, o que acontece escrito, perigo em vermelho, Cancelar primeiro.
- **Botão trabalhando:** todo botão que dispara `api()` ganha um giro se demorar mais de 180 ms, até o último pedido da ação terminar (`BT_ATUAL` / `donoDoPedido`). Evita clique duplo que cobra ou envia duas vezes.
- **Celular:** nenhuma tela pode rolar pro lado; endereços longos quebram linha; ações do cabeçalho descem pra baixo do título.
- **Tarja do topo** (`pillWa` / `pillLeads` em `render()`): mostra o canal **da tela**. Nas telas do Telegram vira uma tarja só: "Telegram no ar | N lead(s) aberto(s)" (só leads do Telegram). Fora: WhatsApp + total de leads.

---

## Decisões do dono (NÃO desfazer sem falar com ele)

| Decisão | Onde no código | Por quê |
|---|---|---|
| **Preços e planos (2026-09-27):** planos do **Telegram** (Bronze/Prata/Gold, números de partida = WhatsApp) no catálogo; preço editável pelo dono em Clientes e licenças → Preços. **Quem já assina mantém o preço do contrato**: mudar preço de plano com cliente (assinatura local ou cliente da carteira com contrato) vira versão nova; venda nova só pelo que está à venda. Tabela antiga (`whats-bot`, `redes-micro`) fora de venda nova | `engine/vsplanos` → `atualizarPlano`, `carregar` (migração), `salvarAdicional`; `engine/vsclientes` → `iniciarCheckout` (fora de venda), ofertas `legado` | "ta faltando telegram bronze prata e gold" · "preciso de um local pra colocar os preços". |
| **Banda por instalação (2026-09-27):** a banda é GERAL do sistema, medida em bytes no ponto onde passa — HTTP do servidor (painel, loja, webhooks), chamadas que o servidor faz (Telegram, Meta, integrações; `fetch` global medido), WhatsApp Web pelo protocolo do Chrome (websocket + downloads da sessão) e mídia guardada no mês. Limite = plano (`storage_limit_mb`, que o contrato chama de "banda total de consumo mensal") + banda adicional. **Passou → MODO CONSULTA:** lê tudo; nada sai pelos canais (nem o bot), nada publica, nada edita (servidor responde 402); o que chega dos clientes continua gravado. Sai do modo ao virar o mês ou ao liberar banda. Oferta: adendo "Banda adicional (+10 GB/mês)" — **sob consulta até o dono dar o preço**; o cliente pede pelo painel, o dono libera com motivo | `engine/vsconsumo` (medidor, `estado`, pedidos), `engine/vsplanos` → `bandaDoMes`/`adicionarBanda`/`removerBanda`, `backend/server.mjs` → `estadoConsumo`, `LIVRE_EM_CONSULTA`, `backend/canais.mjs` → `comTrava` | Pedido do dono: "consumo geral no sistema… uma banda para cada cliente, passou disso deixa em modo consulta e oferece o adendo de banda". |
| E-mail do dono (`CONSOLE_ADMIN_EMAIL` + `velosobil@gmail.com`) entra como **dono** com a senha de dono **ou** com a senha da conta de cliente | `backend/usuarios.mjs` → `entrar()`, `autenticar()` | O e-mail pessoal dele também é cliente (compra de teste); caía na tela de compra sem caminho pro dashboard. |
| Receita de um canal **só com vínculo rastreável**: pedido gerado pelo bot na conversa do canal **+** pagamento confirmado (`CONFIRMADO`/`DISPONIVEL`) | `engine/vsresultados` → `registrarPedido`, `resumo` | Não mostrar faturamento que o comerciante não consegue comprovar. |
| "Pagar na entrega" = pedido, **nunca** receita. Estorno/chargeback não contam. | idem | idem |
| Retomada de pedido: **uma** mensagem por pedido; "recuperado" só se pagar **depois** da retomada; oportunidade = sem pagar há 30 min a 7 dias | `engine/vsresultados`, rota `resultados/retomar` | Insistir vira incômodo; contar pagamento anterior inflaria o número. |
| Campanha: link `t.me/<bot>?start=<codigo>`, **último toque**, janela de **30 dias**; código inventado é ignorado | `engine/vsresultados` → `registrarOrigem`, `campanhaVigente` | Proposta do dono (campanhas rastreáveis). |
| Bot do Telegram **não inicia conversa** com quem nunca falou com ele — nada de disparo em massa | tela Campanhas (texto) | Regra do Telegram + consentimento. |
| Identidade do Telegram = `999` + id com 12 dígitos (15 dígitos fixos) | `engine/canais/telegram` → `idTelegram`, `ehTelegram` | Reusa lead/fila/protocolo/bot sem reescrever o domínio; 999 não é código de país; tamanho fixo impede virar celular com 55. |
| Telegram por **long polling**, não webhook | `engine/canais/telegram` | Funciona atrás do túnel, sem segredo de webhook; Telegram guarda mensagens enquanto o painel está fora. |
| Token do Telegram: arquivo próprio `canais/telegram.json` (600), gravado só depois que o Telegram aceita, **nunca** volta pra tela | `backend/canais.mjs` → `conectarTelegram`, `telegramInfo` | Token dá acesso total ao bot. |
| **Vendedor assume** a conversa: botão "Assumir atendimento" **ou** responder pelo painel. O bot fica em silêncio com aquela pessoa (4 h, renovado a cada resposta) até "Devolver pro bot". | `backend/server.mjs` → `atendimentos/assumir`, `atendimentos/responder`; `engine/vsbot` → `assumirConversa()` | Antes, responder pelo painel numa conversa que estava com o bot deixava os dois falando ao mesmo tempo. |
| Situação da conversa: **aguardando** (bot transferiu, ninguém pegou) ≠ **com vendedor** (alguém assumiu) ≠ **com o bot**; "Pedido concluído" = com o bot + último pedido pago | `server.mjs` (GET atendimentos) + `situacaoDe()` no crm.html | É o que responde "quem precisa de mim agora". |
| Assumir **não apaga** a hora da transferência: `transferidaEm` e `assumidaEm` são marcos fixos; só `handoffEm` renova (é ele que segura o silêncio) | `engine/vsbot` → `assumirConversa()` | O histórico mostra os dois momentos; o cliente não precisa repetir a história. |
| Hora no Atendimento no **fuso de quem olha** (`toLocaleTimeString`), nunca cortando o texto ISO | `telaAtendimento()` → `hora()` / `dia()` | Cortar o ISO dava UTC: 3 h adiantado no Brasil. |
| **Cada canal tem a sua tela**: pedido sobre o Telegram não altera o WhatsApp (e vice-versa). Layout do Telegram é **diferente** do WhatsApp. Layout novo: mostrar opções e **perguntar antes** | `telaFilaTelegram()` × `telaAtendimento('whatsapp')` | "A tela do Telegram é do Telegram"; evita retrabalho. |
| Consumo × Resultados são telas separadas | menu Telegram | Consumo = quanto se conversou; Resultado = quanto virou dinheiro (é o que vende). |
| Financeiro fica **fora do menu** (a tela existe no código) | comentário em `GRUPOS` | Cada empresa controla caixa do seu jeito; genérico é pior que nada. |
| QA-Gate e MCP `vs-ia-dev` **desligados** por decisão do tech lead (2026-09-27) — ele vai refatorar | fora do repo (`~/.claude/settings.json`, `~/.claude.json`) | "Não é funcional." Ausência de recibo do gate não é bloqueio enquanto valer. |
| Postura de produto: **somar** ao que o cliente já tem, nunca substituir o sistema dele | — | Diretriz geral do dono. |
| **Prioridade (decisão do dono, 2026-09-27): TikTok e redes sociais (Instagram incluso) são as ÚLTIMAS coisas** — tomam muito tempo. Agora é firmar o que já tem base (WhatsApp, Telegram, CRM, Visão geral…). Kwai e outras plataformas: só em versões futuras. Não propor nem começar rede sem ele pedir | `engine/vsinstagram` (só `auth.mjs`/`store.mjs`), `engine/vstiktok` | "TikTok e rede social são as últimas coisas que vou fazer… tô fazendo o que já temos base." Telas do Telegram com dados: "ficou bom" (QA confere os números). |
| **Sem IA por enquanto** (custo do produto): auditor de campanha e qualificação de lead são **regras** determinísticas | `engine/vscampanhas`, `engine/vsqualificacao` | "IA aumenta muito o custo"; testar fazendo. |
| **Destinos ficam em Telegram → Canal e conexão** ("Onde o bot trabalha") — **Canal e conexão configura onde o bot trabalha; Campanhas decide o que e quando publicar.** "Adicionar destino": Conectar canal (abre `t.me/<bot>?startchannel=true&admin=post_messages`), Conectar grupo (`?startgroup=true`), Cadastrar pelo ID/@. O que chega em até 10 min depois do clique, com permissão, entra **já confirmado** (foi o dono); bot posto por outra pessoa fora do painel fica **pendente**. Cadastro pelo ID feito pelo dono, com permissão, entra confirmado. Campanhas mostra só os liberados + política de frequência | `aguardarDestino()`, `registrarEventoMembro()`, `cadastrarDestino(…, {confirmar})`; `tgDestinosCard()`/`tgConectar()` no crm.html; `GET /crm/api/telegram/destinos`, `POST campanhas/destino/aguardar` | Pedido do dono (2026-09-27): aumentar os lugares das campanhas sem o cliente caçar chat_id. |
| **Auditor de campanhas — especificação do dono (2026-09-27):** a auditoria VERIFICA, o cliente APROVA, o sistema PUBLICA. **Campos obrigatórios por objetivo** (produto: produto, descrição, preço, destino · promoção: produto, preço promocional, validade, condições · evento: nome, descrição, data, horário, local OU link · captar: solução, público-alvo, benefício real, ação depois do clique — sem preço). **3 resultados:** Aprovado · Aprovado com recomendações · Reprovado (falta obrigatória, incoerência comprovada ou arquivo inválido). **Estética não reprova** (maiúsculas, imagem lisa/escura, imagem enviada não verificável = recomendação). **"Monta pra mim" = pedido de ajuda** → reprova e abre o assistente. **Assistente** ("Me ajude a montar a campanha", no próprio formulário): mostra o que já sabe do catálogo, pergunta só o que falta, monta de modelo aprovado **sem inventar oferta**; sem IA. Toda auditoria guarda **evidências** (`c.auditorias`). **Backend revalida antes de publicar** (versão aprovada = versão atual, incluindo preço/estoque do catálogo); mudança → "Reabrir para revisão" (sai do ar, cancela agendadas; reaprovação reativa o mesmo link) | `engine/vscampanhas` → `requisitosDoObjetivo`, `auditar` (`veredito`), `ehPedidoDeAjuda`, `revalidar`, `reabrir`; `cpAjudaHtml()`/`cpFaltando()` no crm.html; `tests/vscampanhas-aceite.test.mjs` (critérios de aceite) | "Não é um auditor de bonito/feio: identifica o que impede, explica e ajuda a resolver." A tela "Campanha automática" foi retirada (inventava a oferta). |
| Campanha: o link **só atribui depois de aprovada** (código entra no `vsresultados` na aprovação); "Revisar" aprova só com ressalva registrada; "Corrigir"/"Bloquear" não aprovam; auditoria guardada **por versão** do material (inclui preço/estoque do catálogo) | `engine/vscampanhas` → `aprovar`, `versaoDe` | Proposta do dono (Campanhas V1). |
| "Entradas pelo link" = cada `/start` com o código; "conversas" = pessoas diferentes. **Não** chamar de cliques | `engine/vsresultados` → `registrarOrigem` (`entradas` por dia) | O Telegram só avisa quem abriu o bot. |
| Qualificação: matriz em ordem, 1ª regra ativa que bate decide; **porte sozinho não decide**; equipe sem ninguém ativo é pulada; a mesma regra não transfere duas vezes (senão "Devolver ao bot" não vale) | `engine/vsqualificacao` → `decidir`; `backend/atendimento.mjs` | Proposta do dono (Tier 1 bot × Tier 2 consultiva). |
| **Toda conversa tem protocolo** (antes só quem usava fluxo em planilha): `garantirProtocolo()` abre quando o bot não abriu — inclusive com bot desligado | `backend/atendimento.mjs` | Sem protocolo não há como encerrar nem auditar. |
| **Finalizar × Encerrar** (decisão do dono, 2026-09-27) — os dois **só com a conversa assumida** (botões desabilitados antes; servidor recusa) · **Finalizar** = desfecho normal: manda "Posso ajudar em algo mais?"; resposta "não" (curta: não/nada/era só isso/tudo certo…) **finaliza** e pede a nota; outra resposta → a conversa segue; sem resposta em 30 min fecha como finalizado · **Encerrar** = à força, **motivo obrigatório** (lista + outro), **sem nota** · **Cliente** também finaliza ("pode encerrar", "era só isso"…) — a frase dele vira o motivo, e pede nota · silêncio (5 min) e moderação continuam | `engine/vsprotocolo` → `DESFECHOS`, `pedirFinalizacao`, `clienteNaoPrecisaMais`, `encerrar({desfecho, motivoTexto})`; rotas `atendimentos/finalizar` e `atendimentos/encerrar` (`contextoFechamento`); `botoesFechamento()` no crm.html | Auditar o que os profissionais estão fazendo: desfecho, quem e motivo no Histórico. |
| **Avaliação** 1 a 5 só depois de **finalizar** (pelo atendente via pergunta final, ou pelo cliente). Encerrar à força e silêncio não pedem. A nota é tratada **antes do bot** e não reabre o protocolo; nota ≤ 3 pede comentário (0 pula); resposta que não é nota fecha a avaliação como "sem resposta". Janela: 2 h (nota), 30 min (comentário) | `engine/vsprotocolo` → `pedirAvaliacao`, `avaliacaoPendente`, `lerNota` | idem |
| Sem atendimento, a tela mostra **bot, canal, equipe (quem está com o painel aberto) e o resumo do dia** — nunca um vazio | `painelTranquilo()`; `GET /crm/api/atendimentos` → `equipe`, `bot` | "Tela vazia fica muito feio." |
| **Horário de funcionamento em calendário** (Bot → Regras e comportamento): semana com início/fim e 2º turno, atalhos (horário comercial, copiar segunda para dias úteis, feriados nacionais do ano) e **datas especiais** (feriado fechado ou horário próprio) que vencem o dia da semana — inclusive turno que vira a madrugada. Hora de Brasília. Vale também para loja **sem fluxo** (só regras); pedir uma pessoa passa e vai para a fila | `engine/vsbot/index.mjs` → `estaAberto`, `faixasDoDia`, `horarioLegivel` (lista as datas especiais dos próximos 30 dias); `hrHtml()`/`hrLer()` no crm.html; formato `{seg:'08:00-12:00, 13:00-18:00', …, excecoes:{'AAAA-MM-DD':{horario,nome}}}` | Pedido do dono (2026-09-27). |
| **Um bot por canal** (decisão do dono, 2026-09-27): WhatsApp e Telegram têm **cada um o seu bot** — config (nome, mensagens, horário, ligado), regras e fluxo. Tela do Telegram: **Telegram → Bot do Telegram** (`#tg-bot`); a do WhatsApp continua em Bot → Regras e comportamento ("Bot do WhatsApp"). O Telegram **nasce como cópia** do bot atual na 1ª leitura (arquivos `config/regras/fluxo.telegram.json` em `vsbot/`) e daí é independente. Conversas: um arquivo só (ids não se misturam). Segurança (socorro/moderação) salva nos dois. Apagar fluxo de um canal só zera conversas daquele canal | `engine/vsbot` → `comCanal()`/`canalAtual()` (AsyncLocalStorage); `backend/atendimento.mjs` → `receberMensagem` roda no canal da mensagem; rotas `/crm/api/bot*` aceitam `canal`; `telaBotDo(canal)`, `BOT_TG`, `botDaTela()` no crm.html | "O Telegram estava usando o bot do WhatsApp — cada um vai ter seu próprio bot." |
| Aviso ao cliente que não saiu diz **o porquê** (erro do canal) | rota `atendimentos/encerrar` → `erroAviso` | "Não consegui avisar" sozinho não ajuda quem atende. |
| **Encerrado sai da fila** e vai pro **Histórico** (fica na lista ativa quem tem protocolo aberto, quem está na fila e conversa antiga **sem protocolo nenhum** — ela nunca foi encerrada; tirar da lista fazia sumir da tela, porque o histórico vem dos protocolos) | `GET /crm/api/atendimentos` (filtro) · `GET /crm/api/atendimentos/historico[/detalhe]` | Auditar depois. Vendedor vê só os dele. |
| Bot **desligado**: conversa sem dono aparece para todo vendedor (ninguém atende sozinho) | `vendedorVe()` | Senão ninguém via o cliente. |
| **Tiers do comercial** (decisão do dono, 2026-09-27): Tier 1 = bot (fixo); humanos **Tier 2 a 6**, nomeados em Qualificação. **Só operador do setor comercial tem tier** (campo aparece só nele; outros setores = null; comercial sem tier = Tier 2). Regra pode mandar para "Tier N do comercial" (rodízio entre os daquele tier); tier sem ninguém é pulado. Padrão: integração/sob medida, 10+ vendedores e 3+ lojas → Tier 2 | `engine/vsoperadores/regras.mjs` (`ehComercial`, `tier`); `engine/vsqualificacao` (`TIERS_PADRAO`, destino `tier`, `distribuir(…,{tier})`, `tiersComGente`) | Antes o padrão mandava para "especialistas/corporativo/suporte", que não existiam no painel do dono → tudo caía no bot. |
| **Coletar o mínimo:** cliente com intenção de compra que ainda não disse porte nem se é sob medida recebe **uma** pergunta de qualificação junto da resposta do bot (texto configurável, liga/desliga) | `precisaPerguntar()`; `backend/atendimento.mjs` | Sem dado, a matriz não decide e tudo cai no Tier 1. |
| Equipe/setor: **singular = plural** ("especialista" × "especialistas") | `normEquipe()` | Um "s" fazia a regra não achar ninguém. |
| **Carteira** escolhe QUEM atende quando vai pra gente, mas **não tira a conversa do bot** sozinha | `decidir(…, {gatilho})` | Cliente de sempre que só quer repetir o pedido segue com o bot. |
| Distribuição: carteira → rodízio da equipe (ordem por id do operador). Nunca aleatório | `distribuir()` | Tem que dar pra explicar por que foi fulano. |
| **Vendedor** (operador com login) vê só o Atendimento: os clientes dele + a fila sem dono da equipe dele/geral. Não mexe em cliente da carteira de outro. Vendedor que assume vira o responsável; o dono assumindo não tira o cliente de ninguém. Porta no **servidor** | `backend/server.mjs` → bloco `quem.papel === 'vendedor'`, `vendedorVe`, `vendedorPode`, `assumiuVira` | Controle de lead e de quem atende. |
| **Proposta do dono — o atendente "profissional pronto" (2026-09-28; V1 do Bot feita no WhatsApp com o layout B que ele escolheu; Caixa ainda NÃO construído)**: o cliente (e o próprio dono) escolhe SÓ **nome, foto, profissão** e o **jeito** (sério · meio a meio · brincalhão); **o resto nós fazemos** — fluxo, mensagens e comportamento profissionais, humanizados ao máximo, sem mensagem genérica, alinhados aos interesses da empresa. Base: pesquisar as melhores empresas de atendimento e fazer melhor, automático, com a IA local (entende) + texto nosso (responde). **Aberto pro cliente:** o catálogo dele (Estoque: produto, estoque, valor, foto, descrição) — cada atendente usa o catálogo do próprio cliente. **Caixa (financeiro "apurativo")**: o que entrou e o que saiu, gráfico, saldo, documento pro dono; só pra venda de produtos e alimentos (sistemas/software terão controle à parte, depois) | bot: `engine/vsbot/profissoes.mjs` → `montar()`; tela `#wa-personalizar`; caixa: a desenhar (`engine/vsfinanceiro` já tem lançamentos, sem tela) | "Nosso cliente, até eu mesmo, só escolher nome, foto e profissão, o resto nós fazemos pra ficar bem profissional." / "Muda aí essa ideia, que vou pensando como quero me controlar." |
| **Prospecção NÃO é campanha** (dono, 2026-09-28): campanha é vitrine (desconto, produto novo, marca) com link; prospecção é pescaria — pode ter resposta ou não, e sem resposta **troca a abordagem**. Tela própria "Prospecção de clientes" (Crescimento) | `engine/vsprospeccao`, `telaProspeccao()` | "Nós não estamos fazendo campanha, sim prospecção." |
| **Regra da pescaria — NÃO MUDAR sem o dono** (aceita em 2026-09-28; **revista por ele no mesmo dia**: "mata a segunda e vamos só em duas"): **Dia 0: e-mail AUTOMÁTICO** com a apresentação formal e o portfólio em anexo (`docs/prospeccao/email-1a-mensagem.txt` + PDF). **Dia 5: WhatsApp — última tentativa, pela mão de gente** (a tela mostra o botão com o texto pronto; a pessoa aperta enviar): "te enviei um e-mail… você recebeu? tem interesse pra darmos continuidade, ou encerro aqui no sistema e agradeço pelo seu tempo. Fico no aguardo". **Não respondeu: encerra — não se insiste.** Respondeu a qualquer momento: sai da cadência e é de vocês (Ligar/WhatsApp). WhatsApp não é automático: mensagem fria em volume bane o número da Micaela | `CADENCIA=[5]`, `TOQUES`, `mensagem()` em `engine/vsprospeccao` | "Se o cara não quer responder, WhatsApp última alternativa, não adianta insistir." |
| **Dados só da base pública** da Receita (dados abertos do CNPJ), fonte gravada em cada empresa; só atividade PRINCIPAL agro; toda mensagem com SAIR. Razão social e responsável dependem dos arquivos Empresas/Sócios (ainda não baixados) | `Prospeccao-Agro/lojas-agro-MT-AM-RN-RS-RR-2026-09.csv` (script `scripts/prospectar-agro-cnpj.mjs` do worktree agro) | LGPD: MEI é pessoa física. |

---

## Telas

Os textos de "Pra que serve", cartões e botões foram **lidos do console rodando** (não escritos de memória). Busque o nome em "Código da tela" dentro de `backend/crm.html`.

### Operação

#### Visão geral  ·  `#visao`
- **Pra que serve:** o **painel do negócio** (opção A escolhida pelo dono em 2026-09-27): quanto entrou, quantos chegaram, quanto virou venda e o que precisa de atenção — WhatsApp + Telegram juntos. Número sem fonte aparece como "—", nunca como zero.
- **O que tem:** período 7/30/90 dias com variação sobre o período anterior · KPIs: Receita confirmada (só pagamento confirmado), Pedidos, Leads novos (WhatsApp · Telegram), Conversão (ganhos ÷ fechados no período), 1ª resposta (TPR) · **Precisa de atenção agora** (fila sem ninguém no WhatsApp e no Telegram, leads esfriando, pedidos esperando pagamento, integrações paradas — cada um leva à tela) · gráficos: Leads novos por dia (verde-água = WhatsApp, violeta = Telegram), Onde os leads estão (funil), Receita confirmada por dia, Atendimentos bot × equipe (azul/laranja, igual ao Auditor) — todos com dica no hover e "ver dados" · Integrações compactas no fim (agora conta o Telegram: "N de 6").
- **Botões:** 7/30/90 dias, Atualizar, Ver todas (integrações), atalhos da atenção
- **Código da tela:** `backend/crm.html` → `telaVisao()`, `carregarVisao()`, `vizBarrasDia()`, `visIntegracoes()` (reusa `audKpi`, `audBarrasH`, `graficoReceita`)
- **Cálculo:** `engine/vspainel/visao.mjs` → `montarVisao` (junta `vsresultados.resumo` dos dois canais, `montarAuditoria` de todos os canais e o CRM)
- **Rotas do servidor:** `GET /crm/api/visao?dias=` (+ `/crm/api/painel`, `/crm/api/status`) → `backend/server.mjs`
- **Paleta dos canais:** validada com o validador do dataviz (claro e escuro, daltonismo OK); verde-água no tema claro fica abaixo de 3:1 → legenda + tabela "ver dados" obrigatórias.
- **Prova em navegador:** `node scripts/prova-visao.mjs` (18 verificações: tela vazia com "—", receita/pedidos/leads/conversão, atenção, cores dos canais, barras, hover, ver dados, troca de período, atalho, celular). Teste: `tests/vspainel-visao.test.mjs`
- **Saiu da tela:** cartão "Sem fonte de dado ainda" (estava errado: dizia estoque vazio com produto cadastrado) e "Pra onde ir agora" (substituído pela atenção).

#### Estoque  ·  `#estoque`
- **Pra que serve:** Cadastro de produto, saldo com reserva e exportação para os canais de venda.
- **O que tem:** indicadores: Produtos, Unidades, Valor parado, Sem saldo · cartões: Exportar para os canais, Lote de exportação por período, Publicações, Catálogo
- **Botões:** Baixar, Gerar lote, Tirar da vitrine, Atualizar, Importar, Exportar, Novo produto, PRODUTO ↑, PREÇO, ESTOQUE, STATUS, ATUALIZAÇÃO
- **Código da tela:** `backend/crm.html` → `S['estoque']  (" 'estoque':()=>" ou " estoque:()=>")`
- **Ações (funções JS):** `baixarFeed()`, `gerarLote()`, `porNaVitrine()`, `tirarDaVitrine()`, `buscarNaTabela()`, `abrirImportar()`, `abrirExportar()`, `novoProduto()`, `ordenar()`, `verProduto()`, `editarProduto()`, `comprarProduto()`, `venderProduto()`, `excluirProduto()`
- **Rotas do servidor:** `/crm/api/estoque/excluir`, `/crm/api/estoque/lote`, `/crm/api/estoque/produto`, `/crm/api/estoque/vender`, `/crm/api/estoque/vitrine` → `backend/server.mjs`
- **Vitrine (2026-09-27):** botão na linha "Pôr na vitrine (loja e Google)" ⇄ "Tirar da vitrine" — não reserva saldo, não passa pelo TikTok. Prova: `node scripts/prova-vitrine.mjs` (8/8; produto sem foto chega ao feed do Google como recusado, com motivo).

#### Loja e Google Shopping  ·  `#loja`
- **Pra que serve:** Sua loja pública e os endereços que o Google precisa. Produto entra aqui pelo 🛒 Vender no Estoque.
- **O que tem:** cartões: Endereços, Produtos na loja (5), Publicações
- **Botões:** Abrir minha loja, Copiar endereço, Ir pro Estoque, Tirar da vitrine
- **Código da tela:** `backend/crm.html` → `S['loja']  (" 'loja':()=>" ou " loja:()=>")`
- **Ações (funções JS):** `tirarDaVitrine()`
- **Rotas do servidor:** `/crm/api/estoque/lotes`, `/crm/api/estoque/publicados`, `/crm/api/estoque/vitrine` → `backend/server.mjs`

#### Segurança  ·  `#seguranca`
- **Pra que serve:** Alerta aos responsáveis, SOS e auditoria do atendimento.
- **O que tem:** cartões: Segurança de quem atende e de quem é atendido
- **Botões:** Salvar segurança, Adicionar responsável, Salvar responsáveis, Enviar alerta de teste, Testar sirene do painel, Acionar SOS
- **Código da tela:** `backend/crm.html` → `S['seguranca']  (" 'seguranca':()=>" ou " seguranca:()=>")`
- **Ações (funções JS):** `salvarSeguranca()`, `segAddResp()`, `salvarResponsaveis()`, `testarAlerta()`, `testarSirene()`, `abrirSos()`
- **Rotas do servidor:** `/crm/api/seguranca`, `/crm/api/seguranca/config`, `/crm/api/seguranca/pendentes`, `/crm/api/seguranca/responsaveis`, `/crm/api/seguranca/sos`, `/crm/api/seguranca/teste`, `/crm/api/seguranca/visto` → `backend/server.mjs`

#### WhatsApp → Bot — regras e comportamento  ·  `#bot-regras`  (era "Bot → Regras e comportamento" no topo do menu até 28/09)
- **Pra que serve:** Atendimento automático: regras, respostas e quando chamar gente. Funciona aqui antes de ligar em qualquer canal.
- **O que tem:** indicadores: Regras, Chamam gente, Estado, Canal · cartões: Testar a conversa, Alguém pode ter entrado na conta do WhatsApp, Fluxo de atendimento, Regras, Como ele se comporta
- **Botões:** Enviar, Limpar, Baixar modelo, Apagar fluxo, Nova regra, Salvar
- **Código da tela:** `backend/crm.html` → `S.bot  (' bot:()=>')`
- **Ações (funções JS):** `simular()`, `baixarModeloFluxo()`, `apagarFluxo()`, `buscarEm()`, `novaRegra()`, `salvarBot()`
- **Rotas do servidor:** `/crm/api/bot/fluxo-apagar`, `/crm/api/bot/simular` → `backend/server.mjs`

#### WhatsApp → Bot — personalizar  ·  `#wa-personalizar`  (era "Bot → Personalizar")
- **Pra que serve:** Escolher quem atende e o jeito dele falar. O resto a gente monta pra ficar profissional (proposta do dono, layout **B**).
- **O que tem:** assistente em 3 passos — **① Quem é** (foto, nome, profissão: Vendedora, Atendente de loja, Recepcionista, Consultor técnico, Suporte) · **② Como fala** (Sério · Meio a meio · Brincalhão) · **③ Pronto** (prévia da conversa: passar pra gente, áudio/foto, fora do horário; com fluxo cadastrado, a 1ª resposta é a **do fluxo** e a prévia diz isso). Embaixo, recolhido: "Ajuste fino, texto por texto (avançado)" com os cartões antigos (Como ele se apresenta, As três mensagens, Foto e nome do número).
- **Regras:** nada vai pro ar antes de **"Ligar atendente"** (confirmação): aí grava nome/profissão/jeito/persona/mensagens no bot do WhatsApp e, se tiver foto ou nome novo, troca no número (WhatsApp Web). **Fluxo pronto da profissão ("preenche automático", dono 28/09):** loja SEM fluxo → o "Ligar" já grava a árvore pronta (`montarFluxo()`); loja COM fluxo (a Micaela) → fica o dela, a não ser que marquem **"Trocar pelo fluxo pronto"** — aí o velho vira `vsbot/fluxo.antes-profissional-<quando>.json` e quem estava no meio de menu volta pro começo (quem está com gente continua com gente). O galho de produtos é **um passo por categoria do Estoque** (preço vigente e esgotado lidos a cada mensagem; categoria NOVA pede "Ligar" de novo); sem categoria cai na vitrine. **Nada cobra:** o pedido (carrinho + nome) vai pra gente fechar valor e pagamento — o `cobrar` sem gateway diria "paga na entrega", errado pra sistema/serviço. Árvores: vendedora (produtos · dúvida · pessoa), atendente (+ acompanhar pedido), recepcionista (pede o nome → assunto → vendas/financeiro/suporte/outro), consultor (equipamento → produtos · orçamento · dúvida técnica), suporte (acesso · erro · uso · cobrança). Textos fixos, revisados, sem IA escrevendo (sem custo); loja citada como "da equipe <loja>" (gênero do nome da loja é desconhecido); fora do horário o atendente fala na 1ª pessoa (gênero do nome também é desconhecido).
- **Botões:** Próximo, Voltar, Ver como fica, Ligar atendente · no avançado: Salvar, Testar no simulador
- **Código da tela:** `backend/crm.html` → `S['wa-personalizar']` + `telaAtendentePronto()`; textos em `engine/vsbot/profissoes.mjs` → `montar()`, `PROFISSOES`, `JEITOS`
- **Ações (funções JS):** `pzIr()`, `pzEscolher()`, `pzFoto()`, `pzLigar()`, `salvarPersonalizacao()`
- **Rotas do servidor:** `/crm/api/bot/profissional` (sem `aplicar` = só prévia; `aplicar:true` = grava), `/crm/api/canais/personalizar`, `/crm/api/bot/config`; GET `/crm/api/bot` devolve `profissoes` e `jeitos`
- **Código do fluxo pronto:** `engine/vsbot/profissoes.mjs` → `montarFluxo()`, `categoriasDoEstoque()`; `engine/vsbot/index.mjs` → `trocarFluxoPronto()`; rota devolve `fluxo:{passos, categorias, inicio, vitrine, temFluxo, vai:'entra'|'troca'|'fica'}`; aceita `trocarFluxo:true`. Tela: caixa `#pzTrocar` (`PZ.trocar`).
- **Provas:** `tests/vsbot-profissoes.test.mjs` 8/8; `scripts/prova-bot-profissional.mjs` 35/35 (Chrome, desktop e celular, fluxo real da Micaela: prévia não mexe no ar, ligar sem marcar mantém o fluxo; marcar "Trocar" troca e guarda cópia idêntica; loja sem fluxo recebe o pronto e a conversa simulada mostra as categorias e o preço do Estoque)

#### Redes sociais → Conexões  ·  `#redes-canal`
- **Pra que serve:** Cada canal por onde a empresa vende, atende ou publica. O estado vem do backend — o que aparece aqui é o que está valendo agora.
- **O que tem:** indicadores: Canais ligados, Atendimento, Em construção · cartões: Atendimento, Vendas e marketplaces, Entrega, Conteúdo e redes sociais, TikTok Shop, TikTok, Verificação de domínio, Domínio de retorno, Como ligar, em dois passos, TikTok · Login e conteúdo
- **Botões:** Gerenciar, Configurar, Em breve, Conectar TikTok Shop, Publicar arquivo, Tirar do ar, Usar este, Reconectar, Publicar, copiar, Salvar credenciais, Conectar conta
- **Código da tela:** `backend/crm.html` → `S.redes  (' redes:()=>')`
- **Ações (funções JS):** `rolarAteCard()`, `autorizarTiktok()`, `salvarVerificacaoTiktok()`, `salvarBaseRedirect()`, `publicarNoTiktok()`, `copiar()`, `salvarAppTiktok()`, `testarRede()`
- **Rotas do servidor:** `/crm/api/redes/testar`, `/crm/api/tiktok/autorizar`, `/crm/api/tiktok/publicar`, `/crm/api/tiktok/redirect-base`, `/crm/api/tiktok/verificacao` → `backend/server.mjs`

#### Redes sociais → O que está incluso  ·  `#redes-planos`
- **Pra que serve:** Canal incluso no plano entra ligando. Canal de marketplace é adendo de contrato e cobrança à parte — não é configuração.
- **O que tem:** cartões: Inclusos no plano, Marketplaces — adendo de contrato
- **Botões:** Solicitar
- **Código da tela:** `backend/crm.html` → `S['redes-planos']  (" 'redes-planos':()=>" ou " redes-planos:()=>")`

#### Redes sociais → Auditor  ·  `#redes-auditor`
- **Pra que serve:** O que entrou pelas redes sociais.
- **O que tem:** indicadores: Eventos, Mensagens, Leads com trilha · cartões: Trilha
- **Botões:** Atualizar
- **Código da tela:** `backend/crm.html` → `auditorDoCanal('rede')`
- **Ações (funções JS):** `buscarEm()`

#### Relatórios  ·  `#relatorios`
- **Pra que serve:** Cruzamento entre o funil do CRM, o catálogo e o conteúdo.
- **O que tem:** indicadores: Ciclo médio, Esquecidos, Origens, Catálogo · cartões: De onde vem quem compra, Onde o funil perde gente, Catálogo pronto pra anunciar, O que NÃO entrou neste relatório
- **Código da tela:** `backend/crm.html` → `S['relatorios']  (" 'relatorios':()=>" ou " relatorios:()=>")`

#### Quebra-Galho → Painel  ·  `#qg-painel`
- **Pra que serve:** Marketplace de serviços locais — BH e Grande BH.
- **O que tem:** cartões: O Quebra-Galho não respondeu
- **Código da tela:** `backend/crm.html` → `S.quebragalho  (' quebragalho:()=>')`

#### Quebra-Galho → Auditor  ·  `#qg-auditor`
- **Pra que serve:** O que veio do marketplace.
- **O que tem:** indicadores: Eventos, Mensagens, Leads com trilha · cartões: Trilha
- **Botões:** Atualizar
- **Código da tela:** `backend/crm.html` → `auditorDoCanal('quebragalho')`
- **Ações (funções JS):** `buscarEm()`

#### Integração CRM  ·  `#crm`
- **Pra que serve:** Pipeline de vendas. O bot vai escrever aqui: cada mensagem vira interação, cada qualificação vira score auditável.
- **O que tem:** indicadores: Abertos, Ganhos, Perdidos, Conversão, **Esfriando** · cartões: Onde os leads estão, **Funil automático**, Leads (selo "parado há N dias" na lista e no quadro)
- **Funil automático (2026-09-27, sem IA):** WhatsApp e Telegram. **Equipe respondeu** (autor `atendente`, não o bot) → etapa de contato · **saiu cobrança/pedido na conversa** → etapa de proposta + valor do pedido vira o valor do lead · **pagamento confirmado** (vigia do Pix, webhook MP/Asaas, conferência, ou ao abrir o CRM) → **Ganho** (e vai para a coluna "Ganho/Fechado" se o funil tiver) · lead aberto sem conversa há N dias (padrão 3) → Esfriando. **Só anda pra frente**; lead fechado não mexe, exceto pago que vence "perdido". Etapas escolhidas pelo **nome** (contato/atend…, proposta/orçam…) ou pela posição; o dono troca no cartão ou desliga. Tudo no histórico com `auto: true` ("· automático" na linha do tempo)
- **Botões:** Atualizar, Novo lead, Abrir no WhatsApp, Marcar como ganho, Marcar como perdido, Salvar regras
- **Código da tela:** `backend/crm.html` → `telaCrm()`, `funilAutoCard()`, `salvarFunilAuto()`, `seloParado()`
- **Código do motor:** `engine/vscrm/automacao.mjs` (`padrao`, `resolver`, `aplicar`, `diasParado`); `engine/vscrm/index.mjs` → `interagir` (resposta da equipe), `eventoDeVenda`, `sincronizarPagamentos`, `getAutomacao`/`setAutomacao`; ligações em `backend/atendimento.mjs` → `funilCobranca()`, `backend/canais.mjs` → `avisarPixPago()`, `backend/server.mjs` → `sincronizarFunil()`
- **Ações (funções JS):** `buscarEm()`, `novoLead()`, `fechar()`
- **Rotas do servidor:** `/crm/api/fechar`, `/crm/api/funil/automacao` → `backend/server.mjs`
- **Prova em navegador:** `node scripts/prova-funil.mjs` (21 verificações: pedido pelo bot → Proposta com valor, dono responde pela tela → Em atendimento, pago → Ganho, parado 5 dias, regra trocada pela tela, recusa de etapa inexistente, celular). Teste: `tests/vscrm-automacao.test.mjs`

#### WhatsApp → Atendimento  ·  `#wa-atendimento`
- **Pra que serve:** a **central de conversas** entre cliente, bot e vendedor. Responde uma pergunta: *quem precisa da minha atenção agora?* (Atendimento é a operação; Resultados é a análise dela — indicador financeiro NÃO entra aqui.)
- **O que tem:** filtros com contagem **Precisam de você · Com vendedor · Com o bot · Todas** (abre em "Precisam de você" se houver alguém); busca; lista com a **situação** de cada conversa (`Aguardando vendedor` pulsando, `Com vendedor`, `Atendido pelo bot`, `Pedido concluído`) e "R$ em aberto"; conversa com cartão do **pedido** (em aberto / concluído / pagar na entrega / cancelado), "o bot já apurou", histórico com marcos **Transferido para humano** e **Vendedor assumiu**, e balão "equipe" nas respostas do vendedor; selo **Bot ativo/desligado** no cabeçalho.
- **Botões:** Assumir atendimento, Devolver pro bot, Encerrar atendimento (ícone ✓), Enviar (Enter envia, Shift+Enter pula linha), Atualizar
- **Atualiza sozinha** a cada 8 s (`recarregarAtendimento`) sem apagar o que o vendedor está digitando nem pular a leitura; só quando a aba está visível e sem modal aberto.
- **Código da tela:** `backend/crm.html` → `telaAtendimento('whatsapp')` · situação: `situacaoDe()` / `SITUACAO` · filtros: `filtrarConversas()` · `assumirAtendimento()` · `recarregarAtendimento()`
- **Ações (funções JS):** `filtrarConversas()`, `buscarConversa()`, `abrirConversa()`, `assumirAtendimento()`, `devolverAoBot()`, `encerrarAtendimento()`, `responderCliente()`, `teclaResposta()`, `crescerResposta()`
- **Rotas do servidor:** `/crm/api/atendimentos` (traz `situacao`, `assumidaEm`, `transferidaEm`, `pedido`), `/crm/api/atendimentos/assumir`, `/crm/api/atendimentos/responder` (**assume sozinho**), `/crm/api/atendimentos/devolver`, `/crm/api/atendimentos/encerrar` → `backend/server.mjs`
- **Motor:** `engine/vsbot` → `emAtendimento()` (fila com `assumida`, `assumidaEm`, `transferidaEm`), `assumirConversa()`, `entregarParaEquipe()`, `devolverAoBot()` · pedido: `engine/vsresultados` → `ultimoPedido()`
- **Testes:** `tests/atendimento-v1.test.mjs`

#### WhatsApp → Canal e conexão  ·  `#canais`
- **Pra que serve:** Onde o cliente fala com você. A mensagem entra por aqui, vira lead e vai pro bot — o atendente trabalha no painel, não no WhatsApp Web.
- **O que tem:** indicadores: Estado, Número, Conectado desde, Última atividade · cartões: Leia com o seu WhatsApp, Como está montado, O número deste canal, Atendentes e setores, Operadores humanos, Perfil do assistente virtual, O que você precisa saber antes de usar com cliente
- **Botões:** Reconectar (gera QR novo), Trocar de número, Desligar o canal, Salvar, Salvar setores, Ampliar no contrato, Editar, Desativar, Adicionar operador, Aplicar no número, Voltar a cara anterior
- **Código da tela:** `backend/crm.html` → `S['canais']  (" 'canais':()=>" ou " canais:()=>")`
- **Ações (funções JS):** `reconectarCanal()`, `trocarNumeroCanal()`, `desconectarCanal()`, `salvarCanalConfig()`, `editarOperador()`, `alternarOperador()`, `salvarOperador()`, `previewPerfil()`, `personalizarCanal()`, `restaurarPerfil()`
- **Rotas do servidor:** `/crm/api/canais/conectar`, `/crm/api/canais/desconectar`, `/crm/api/canais/personalizar`, `/crm/api/canais/restaurar-perfil`, `/crm/api/canais/trocar-numero`, `/crm/api/operadores/salvar` → `backend/server.mjs`

#### WhatsApp → Auditor  ·  `#wa-auditor`
- **Pra que serve:** a MESMA tela do Telegram · Auditor (padrão de mercado), com os dados do WhatsApp — pedido do dono: "mesma pegada, diferenciar só as informações".
- **O que tem / botões:** iguais ao Telegram → Auditor (KPIs TPR/TMA/SLA/CSAT/bot com variação, 6 gráficos, log de auditoria em acordeão fechado, Apresentar, Imprimir/PDF, Exportar log). Campanhas não entram no log (são do Telegram).
- **Código da tela:** `backend/crm.html` → `telaAuditorCanal('whatsapp')`; dados `GET /crm/api/auditor/canal?canal=whatsapp`. A trilha antiga (`auditorDoCanal`) segue só em Redes sociais e Quebra-Galho → Auditor.
- **Prova:** `scripts/prova-auditor.mjs` (40/40) — mostra a Clara e os encerrados à força do WhatsApp, nada do Telegram.

#### WhatsApp → Consumo  ·  `#wa-consumo`
- **Pra que serve:** banda do mês **GERAL da instalação** (todos os canais, painel, loja, integrações e mídia somam no mesmo limite) + o recorte do WhatsApp. Passou do limite → **modo consulta** e oferta do **adendo de banda**.
- **O que tem:** medidor (usado × limite, % , aviso em 80%, renova dia 1º, projeção no ritmo do mês, limite = plano + banda adicional) · KPIs do canal (banda do WhatsApp, conversas, respostas do bot/equipe, via (WhatsApp Web), custo por mensagem R$ 0) · Banda por dia (WhatsApp × resto do sistema) · Para onde foi a banda (categorias) · Banda adicional e pedidos (dono: liberar/tirar, com motivo) · Como é medido.
- **Código da tela:** `backend/crm.html` → `telaConsumoCanal('whatsapp')`; dados `GET /crm/api/consumo?canal=…`; faixa de aviso em todas as telas `faixaConsumo()` (via `GET /crm/api/consumo/estado`).
- **Prova:** `scripts/prova-consumo.mjs` (17/17) · `tests/vsconsumo.test.mjs`.

#### WhatsApp → Desconectar do telefone  ·  `#wa-desconectar`
- **Pra que serve:** Tirar o bot do WhatsApp do aparelho.
- **O que tem:** indicadores: Estado, Número · cartões: Pausar o bot, Desconectar do telefone
- **Botões:** Religar (sem QR), Desconectar do telefone
- **Código da tela:** `backend/crm.html` → `telaDesconectar()`
- **Ações (funções JS):** `conectarCanal()`, `despararCanal()`
- **Rotas do servidor:** `/crm/api/canais/conectar`, `/crm/api/canais/desparear` → `backend/server.mjs`

#### Telegram → Atendimento  ·  `#tg-atendimento`
- **Pra que serve:** a **fila de atendimento** do Telegram — *quem precisa da minha atenção agora?* Layout **próprio do Telegram** (quadro de fila), escolhido pelo dono entre 3 opções em 2026-09-27; **não é** o inbox do WhatsApp.
- **Resumo no topo** (pequeno): Aguardando N · Com vendedor N · Com o bot N — mesmos nomes das colunas.
- **Cartão** (fase 2 do dono): nome, última mensagem (bot/você), **"Última mensagem: HH:MM"** (fuso local), **tempo** — `Aguardando há X` / `Sem resposta há X` (cliente escreveu, vendedor não respondeu) / `Respondido há X` / `Última mensagem há X` — com cor que esquenta (≥5 min âmbar, ≥15 min vermelho), pedido em aberto/pago e botão **Assumir** direto no cartão de quem aguarda (abre o painel). Tempos redesenham a cada ~1 min.
- **O que tem:** 3 colunas com contagem — **Aguardando vendedor** (quem espera há mais tempo em cima), **Com vendedor**, **Com o bot** (inclui "pedido pago"); cartão com avatar, última mensagem (bot/você), pedido em aberto ou pago; busca; com zero conversas mostra as colunas vazias + lembrete com o link do bot. Clicar no cartão abre o **painel lateral** (tela cheia no celular): situação, Assumir/Devolver, Encerrar, cartão do pedido, "o bot já apurou", histórico com marcos Transferido/Assumiu, resposta (Enter envia). Esc ou × fecha.
- **Atualiza sozinha** a cada 8 s com o painel aberto, sem apagar o texto digitado.
- **Código da tela:** `backend/crm.html` → `telaFilaTelegram()` · abrir/fechar: `abrirCartaoTg()`, `fecharGavetaTg()` (estado `TG_GAVETA` + `CONVERSA`) · situação compartilhada: `situacaoDe()` / `SITUACAO`
- **Ações (funções JS):** `abrirCartaoTg()`, `fecharGavetaTg()`, `buscarConversa()`, `assumirAtendimento()`, `devolverAoBot()`, `encerrarAtendimento()`, `responderCliente()`, `teclaResposta()`, `recarregarAtendimento()`
- **Rotas do servidor:** as mesmas do Atendimento do WhatsApp (`/crm/api/atendimentos`, `…/assumir`, `…/responder`, `…/devolver`, `…/encerrar`) → `backend/server.mjs`
- **Motor e testes:** idem WhatsApp (`engine/vsbot`, `engine/vsresultados` → `ultimoPedido()`, `tests/atendimento-v1.test.mjs`)

#### Telegram → Resultados  ·  `#tg-resultados`
- **Pra que serve:** Quanto o Telegram colocou no seu bolso. Só conta venda com pagamento confirmado.
- **O que tem:** indicadores: Receita atribuída, Pedidos concluídos, Leads atendidos, Conversão · cartões: Sua primeira venda pelo Telegram em 3 passos, Oportunidades de retomada, Por campanha
- **Botões:** 7 dias, 30 dias, 90 dias, Abrir bot, Abrir fluxo do bot, Criar campanha, Ver campanhas
- **Código da tela:** `backend/crm.html` → `telaResultados('telegram')`
- **Ações (funções JS):** `trocarPeriodo()`
- **Rotas do servidor:** `/crm/api/resultados`, `/crm/api/resultados/retomar` → `backend/server.mjs`

#### Telegram → Campanhas  ·  `#tg-campanhas`
- **Pra que serve:** Um link por divulgação. Quem entra pelo link chega com a campanha marcada — e a venda que sair dali é creditada a ela.
- **O que tem (V1):** assistente em 4 passos — **Conteúdo** (4 objetivos: produto, promoção, evento, captar; produto puxa nome/preço/foto do catálogo; texto montado dos dados; imagem enviada ou do catálogo; texto do botão; código do link) → **Auditoria** (Produto e preço · Imagem · Mensagem · Destino, níveis Aprovado/Sugestão/Atenção/Revisar/Corrigir/Bloqueado) → **Aprovação** → **Divulgação** (link + "texto + link") — com **prévia estilo Telegram** ao lado. Embaixo: **Acompanhamento** (Campanha · Situação · Entradas pelo link · Conversas iniciadas · Pedidos · Receita confirmada); clicar abre prévia, resultados, relatório do auditor e histórico. Links antigos aparecem como "Captar clientes · link antigo".
- **Estados:** Rascunho · Em revisão · Aguardando aprovação · Ativa · Encerrada. **Publicação** tem estado próprio: Agendada · Publicando · Publicada · Falha · Cancelada.
- **2ª entrega (2026-09-27) — Destinos de publicação:** o bot entra num canal/grupo → evento `my_chat_member` → destino **pendente** até o dono **confirmar** (qualquer um pode adicionar o bot). Cadastro manual pelo @ (`getChat` + `getChatMember`). Canal exige bot admin com "Publicar mensagens"; sem permissão fica marcado e não publica; bot removido marca o destino e a agendada falha com o motivo. **Publicar agora ou agendar** (campanha ativa): foto + legenda + **botão** com o link rastreável; guarda o link da postagem. **Política de frequência por destino** (padrão 4 h entre campanhas e 3 por dia — a proposta do dono foi cortada no valor; ajustável na tela). Agendador a cada 30 s, uma rodada por vez (trava única com "publicar agora"), ≤ 1 msg/s. Rotas `campanhas/destino/{verificar,confirmar,remover}`, `campanhas/{publicar,politica}`, `campanhas/publicacao/cancelar`. Prova: `prova-campanhas.mjs` 26/26 (Telegram falso agora simula canal, `getChat`, foto com botão e `_membro`).
- **Código da tela:** `backend/crm.html` → `telaCampanhas()`, `cpAssistente()`, `cpPreviaHtml()`, `abrirCampanha()`
- **Rotas do servidor:** `GET /crm/api/campanhas`, `POST /crm/api/campanhas/{salvar,auditar,aprovar,encerrar,excluir}`, `/crm/api/resultados/campanha/arquivar` (links antigos) → `backend/server.mjs` (`contextoCampanha()` lê catálogo, imagem em `/midia` e link do bot)
- **Prova em navegador:** `node scripts/prova-campanhas.mjs` (instância isolada + Telegram falso, 18 verificações)

#### Histórico de atendimentos  ·  botão **Histórico** em `#wa-atendimento` e `#tg-atendimento`
- **Pra que serve:** Atendimentos encerrados — pelo cliente, pelo atendente ou por silêncio — para auditar depois.
- **O que tem:** indicadores Encerrados (com gente), Nota média (quantos avaliaram), Pelo cliente, Pelo atendente, Por silêncio · busca (nome, protocolo, atendente) · período hoje/7/30/90 · filtros Todos, Com gente, Cliente encerrou, Atendente encerrou, Por silêncio, Avaliados, Nota até 3 · tabela Cliente/protocolo, Encerrado/duração, Atendido por, Quem encerrou, Avaliação (estrelas, 💬 = comentário), Mensagens · clicar abre o detalhe: dados, comentário do cliente, resumo comercial e a **conversa inteira** daquele protocolo.
- **Código:** `telaHistorico(canal)`, `abrirAtendimentoHist()` em `backend/crm.html`; encerrar com texto "Encerrar" nas duas telas (`encerrarAtendimento()` → modal avisa protocolo + avaliação).
- **Prova em navegador:** `node scripts/prova-encerramento.mjs` (17 verificações: vendedora encerra, cliente encerra no Telegram e no WhatsApp, notas 2/5/4, comentário, saem da fila, histórico do dono e da vendedora, celular).

#### Orçamentos  ·  `#orcamentos`  (serve WhatsApp **e** Telegram; vendedor vê só os dele)
- **Pra que serve:** o vendedor monta o orçamento SEM sair da conversa; o cliente recebe texto + **PDF** + link e aprova num toque. Pedido do dono (2026-09-28): "muito nego falando que tem que ficar entrando em sistema ruim pra fazer orçamento".
- **Na conversa:** botão **Orçamento** na conversa do WhatsApp e na gaveta do Telegram → janela (modal) com os orçamentos anteriores do cliente + itens (catálogo via lista, preço vem junto; item livre), desconto R$ ou %, frete, validade (dias), condições, observações; total ao vivo com a mesma regra do servidor. **Salvar rascunho** · **Salvar e enviar ao cliente**.
- **Tela:** KPIs Orçado · Aprovado · Taxa de aprovação (sobre quem já decidiu) · Aguardando cliente; 7/30/90 dias; tabela Número · Cliente · Vendedor · Total · Situação · Validade · ações (Editar/Enviar no rascunho, Reenviar, **Cobrar por Pix** no aprovado, Ver, PDF, Duplicar, Cancelar).
- **Só o catálogo (dono, 2026-09-28):** item só entra se for produto ATIVO do Estoque com preço; nome e preço vêm de lá (o vendedor escolhe numa lista, não digita). Negociação = desconto. Catálogo vazio → a janela manda cadastrar no Estoque. "Vendo hambúrguer e faço orçamento de camisa — lógica nenhuma."
- **Situações:** Rascunho · Enviado ("Aguardando cliente") · Aprovado · Recusado · Vencido (validade conta do ENVIO) · Cancelado. Enviado não se edita — **Duplicar** gera rascunho novo. Link público `/orcamento/<código secreto>` (não o número), noindex, limite por IP; aprovar/recusar pelo link manda confirmação na conversa e anota no lead.
- **Funil:** enviado → evento `cobranca` (lead vai pra proposta com o valor). Cobrar por Pix = mesmo caminho do bot: `vspagamentos.cobrar` + `vsresultados.registrarPedido` + vigia do Pix (pagou → Ganho).
- **Código:** `engine/vsorcamentos` (regras, centavos inteiros, numeração ORC-AAAA-NNNN, HTML do documento = página e PDF); `backend/orcamentos.mjs` (envio texto+PDF via `canais.enviar/enviarArquivo` + `imprimirPdf`, aviso da resposta, cobrança); tela `telaOrcamentos()`, janela `abrirOrcamento()` no crm.html.
- **Rotas:** `GET /crm/api/orcamentos[?telefone=|?dias=]` (lista + resumo + catálogo), `GET /crm/api/orcamentos/pdf?id=`, `POST /crm/api/orcamentos/{salvar,enviar,cancelar,duplicar,cobrar}`; público `GET /orcamento/<token>`, `POST /orcamento/<token>/{aprovar,recusar}`.
- **Prova:** `node scripts/prova-orcamentos.mjs [--telas pasta]` — 28 verificações (fila → assumir → janela → vazio recusado → catálogo → total → envio texto+PDF → funil → outro vendedor barrado → cliente aprova pelo link → confirmação → tela → cobrar sem gateway mostra erro → duplicar → aprovado não edita → celular). Teste: `tests/vsorcamentos.test.mjs` (12).

#### Qualificação e equipes  ·  `#qualificacao`  (serve WhatsApp **e** Telegram)
- **Pra que serve:** O bot lê a conversa, preenche a ficha do cliente e decide — por regras, sem IA — se ele mesmo vende (Tier 1) ou se passa para a equipe certa (Tier 2).
- **O que tem:** cartões: **Como o bot decide** (matriz em ordem: ligar/desligar, condição, destino, equipe, subir/descer, nova regra, voltar ao padrão, mensagem ao transferir), **Testar com uma conversa** (não grava, não gira rodízio), **Equipes e acesso dos vendedores** (operador · equipe = setor · acesso: dar acesso, nova senha, tirar acesso)
- **Matriz padrão:** carteira → vendedor dele · reclamação → suporte · (suporte → suporte, desligada) · integração/sob medida → especialistas · 10+ vendedores → corporativo · 3+ lojas → corporativo
- **No Atendimento (dois canais):** cartão **Oportunidade comercial** (Tier, resumo, ficha: intenção/produto/porte/complexidade/prazo/necessidade, equipe, responsável — o dono troca ali —, próxima ação, o que falta saber); selos Tier 2 e responsável na lista (WhatsApp) e no cartão da fila (Telegram); eventos "Encaminhado para…" e "Responsável: …" na linha do tempo; "Fulano assumiu" com o nome.
- **Modo vendedor:** login com e-mail e senha inicial dada pelo dono; menu só com Atendimento WhatsApp/Telegram.
- **Código:** `engine/vsqualificacao/index.mjs` (`qualificar`, `decidir`, `distribuir`, `resumo`); ligação em `backend/atendimento.mjs` (depois da resposta do bot); tela `telaQualificacao()`, cartão `oportunidadeHtml()`, modo `carregarVendedor()` em `backend/crm.html`
- **Rotas:** `GET /crm/api/qualificacao`, `POST /crm/api/qualificacao/{salvar,simular}`, `POST /crm/api/vendedores/{acesso,remover}`, `POST /crm/api/atendimentos/responsavel`
- **Prova em navegador:** `node scripts/prova-qualificacao.mjs` (23 verificações: Tier 1/Tier 2 nos dois canais, dono, vendedora, 403, celular)

#### Telegram → Canal e conexão  ·  `#tg-canal`
- **Pra que serve:** O bot do Telegram atende com o mesmo robô, o mesmo funil e a mesma fila do WhatsApp.
- **O que tem:** indicadores: Estado, Bot, Conversas, Última atividade · cartões: Seu bot está no ar
- **Botões:** Desconectar, Copiar link, Trocar o token
- **Código da tela:** `backend/crm.html` → `telaTelegram()`
- **Ações (funções JS):** `desconectarTelegram()`
- **Rotas do servidor:** `/crm/api/canais/conectar`, `/crm/api/canais/desconectar`, `/crm/api/canais/telegram` → `backend/server.mjs`

#### Telegram → Auditor  ·  `#tg-auditor`
- **Pra que serve:** auditoria no padrão de mercado (Zendesk/Intercom/Blip): desempenho do atendimento + log de auditoria, só do Telegram, pronto para apresentar.
- **O que tem:** período 7/30/90 dias com **variação sobre o período anterior** · KPIs: Conversas, Resolvidas pelo bot, **TPR** (fila → 1ª resposta da equipe, com p90), **TMA** (abertura → encerramento), **SLA** (≤ 5 min), **CSAT** (% notas 4–5) · gráficos: Atendimentos por dia (bot × equipe, com "ver dados"), Funil, Horário de pico (dia × hora), Desfechos + motivos do "à força", Satisfação 1–5, Desempenho por atendente · **Log de auditoria** num acordeão **fechado por padrão** (pedido do dono: "polui a tela"; abre ao clicar) (quem, evento, detalhe, protocolo; filtro por tipo, busca, paginação).
- **Botões:** 7/30/90 dias · Apresentar (tela cheia, sem menu; Esc sai) · Imprimir / PDF · Exportar log (CSV para Excel)
- **Código da tela:** `backend/crm.html` → `telaAuditorCanal('telegram')`; dados `GET /crm/api/auditor/canal?canal=telegram&dias=30` → `engine/vsauditoria` (`montarAuditoria`). Sem IA: tudo calculado do que foi gravado (protocolos, histórico do lead, segurança, campanhas). Paleta validada: azul = bot, laranja = equipe.
- **Testes/prova:** `tests/vsauditoria.test.mjs` · `scripts/prova-auditor.mjs` (40/40). WhatsApp → Auditor continua o antigo (`auditorDoCanal`).

#### Telegram → Consumo  ·  `#tg-consumo`
- **Pra que serve:** banda do mês **GERAL da instalação** (todos os canais, painel, loja, integrações e mídia somam no mesmo limite) + o recorte do Telegram. Passou do limite → **modo consulta** e oferta do **adendo de banda**.
- **O que tem:** medidor (usado × limite, % , aviso em 80%, renova dia 1º, projeção no ritmo do mês, limite = plano + banda adicional) · KPIs do canal (banda do Telegram, conversas, respostas do bot/equipe, publicações de campanha, custo por mensagem R$ 0) · Banda por dia (Telegram × resto do sistema) · Para onde foi a banda (categorias) · Banda adicional e pedidos (dono: liberar/tirar, com motivo) · Como é medido.
- **Código da tela:** `backend/crm.html` → `telaConsumoCanal('telegram')`; dados `GET /crm/api/consumo?canal=…`; faixa de aviso em todas as telas `faixaConsumo()` (via `GET /crm/api/consumo/estado`).
- **Prova:** `scripts/prova-consumo.mjs` (17/17) · `tests/vsconsumo.test.mjs`.


### Crescimento

#### Prospecção de clientes  ·  `#prospeccao`  (Crescimento; vendedor também vê)
- **Pra que serve:** a pescaria — ir atrás de empresa por empresa, por região, com o plano aprovado em cima. **Não é campanha.**
- **O que tem:** selo "Aprovado por Fabiano Veloso — tech lead do projeto" · Propósito · Duração (dia X de 10) · Meta · A contatar · Contatados · Tocar hoje · tabela de **Regiões** (MT, AM, RN, RS, RR; abordagem da vez, na lista, contatados, responderam, demos, clientes, situação; "Trocar abordagem" quando 5 sem resposta e nenhum retorno — só o dono troca) · **Empresas e contatos** (busca, filtro por região, 10/50/100 por página; fonte "Receita Federal — dados abertos do CNPJ" em cada uma; alertas de qualidade) · Balanço (dono) com PDF.
- **Regra (não mudar):** dia 0 = e-mail AUTOMÁTICO com o portfólio (cartão "Envio automático por e-mail", só o dono dispara o lote); dia 5 = "WhatsApp · última tentativa" (gente, texto do dono); sem resposta = encerra. "Respostas prontas" pra grosseria, "de onde veio o número" e sem interesse. Ver "Decisões do dono".
- **Código:** `engine/vsprospeccao` (`painel`, `importarLista`, `mover`, `situacaoRegiao`, `mensagem`, `balanco`); tela `telaProspeccao()`, `prospPagina()`, `prospLigou()` no crm.html.
- **Rotas:** `GET /crm/api/prospeccao/envio` e `POST /crm/api/prospeccao/envio {quantos, confirmar}` (dono), `GET /crm/api/prospeccao/respostas`, `GET /crm/api/prospeccao?regiao=&busca=&pagina=&limite=`, `GET /crm/api/prospeccao/balanco[/pdf]`, `POST /crm/api/prospeccao/{plano,regiao,regiao/remover,abordagem,contato,mover}` (vendedor: só contato e mover).
- **Fonte com link:** chips no cabeçalho da lista e "fonte: … ↗" em cada empresa (`prospFontes()`, `prospFonteLinha()`, `FONTES` no engine).
- **Dados:** `~/.qa-gate/vsprospeccao/prospeccao.json` — 13.342 empresas (agro principal) importadas de `Prospeccao-Agro/lojas-agro-MT-AM-RN-RS-RR-2026-09.csv`.

#### Clientes e licenças  ·  `#clientes`
- **Pra que serve:** quem comprou, o que foi liberado, em que pé está cada um — e a **tabela de preços** (o dono edita aqui).
- **Abas:** **Carteira** · **Preços**.
- **Carteira:** indicadores Clientes, Ativos, Vencendo (≤ 5 dias), Aguardando pagamento, Receita mensal · filtros por situação com contagem (Todos, Em cadastro, Aguardando pagamento, Ativos, Vencendo, Vencidos) · busca (nome, CPF/CNPJ, WhatsApp) · colunas Cliente, Plano, **Valor/mês** (do contrato; sem contrato, da tabela), **Vence em**, Situação.
- **Cadastro:** módulo (WhatsApp, Telegram, Redes sociais, WhatsApp + Redes, Sob consulta) → **um** plano (Bronze/Prata/Gold) → ciclo Mensal ou Semestral (do catálogo). Tabela antiga (Bot WhatsApp R$ 39,90, Redes Micro) e versões antigas só aparecem para quem já as tem.
- **Detalhe:** etapas no topo (Contrato → Assinatura gov.br → Pagamento → Chave) + o liberado em cartões; os passos com ação continuam embaixo.
- **Preços:** um bloco por módulo (preço, atendentes, produtos, campanhas/mês, banda GB, contas de rede, auditor, mais escolhido) + adendos (atendente adicional R$, banda adicional GB + R$; vazio = sob consulta). **Regra do dono:** quem já assina mantém o preço do contrato — mudar preço de plano com cliente cria **versão nova** (`-v2`, `-v3`…) para as vendas novas; sem cliente, muda no lugar.
- **Código:** `backend/crm.html` → `telaClientes()`, `telaPrecos()`, `salvarPrecos()`; `GET /crm/api/precos`, `POST /crm/api/precos/plano|adicional` → `engine/vsplanos` (`atualizarPlano`, `salvarAdicional`).
- **Prova:** `scripts/prova-clientes-precos.mjs` (20/20).

#### Indicações e parceiros  ·  `#indicacao`
- **Pra que serve:** Você define a regra aqui. Enquanto ela não existir, a suíte não calcula comissão nenhuma — não chuta percentual.
- **O que tem:** indicadores: Parceiros, Indicados, A pagar, Numa venda de r$ 1.000 · cartões: Regra de comissão, Parceiros
- **Botões:** Salvar regra, Atualizar, Novo parceiro, Copiar o link, Remover parceiro
- **Código da tela:** `backend/crm.html` → `telaIndicacao()`
- **Ações (funções JS):** `salvarRegra()`, `buscarEm()`, `novoParceiro()`, `copiar()`, `removerParceiro()`
- **Rotas do servidor:** `/crm/api/parceiros/remover` → `backend/server.mjs`


### Conta

#### Plano e acesso → Planos e preços  ·  `#pl-planos`
- **Pra que serve:** Três planos por módulo. O que for diferente disso entra como adendo.
- **Botões:** Mensal, Semestral −10%, WhatsApp, Redes sociais, WhatsApp + Redes, Assinar Bronze, Assinar Prata, Assinar Gold, Falar com a gente
- **Código da tela:** `backend/crm.html` → `telaPlanos()`
- **Ações (funções JS):** `assinarPlanoCk()`

#### Plano e acesso → Consumo  ·  `#pl-consumo`
- **Pra que serve:** O que a licença desta máquina autoriza, agora.
- **O que tem:** indicadores: Licença, Plano, Validade · cartões: Detalhe, Compra e recebimento
- **Código da tela:** `backend/crm.html` → `S['pl-consumo']  (" 'pl-consumo':()=>" ou " pl-consumo:()=>")`

#### Plano e acesso → Comprar acesso  ·  `#pl-comprar`
- **Pra que serve:** Escolha o pacote e gere a cobrança — Pix na hora.
- **O que tem:** cartões: Essencial, Operação, Omnichannel, Como funciona
- **Botões:** Gerar cobrança
- **Código da tela:** `backend/crm.html` → `S['pl-comprar']  (" 'pl-comprar':()=>" ou " pl-comprar:()=>")`
- **Ações (funções JS):** `comprarPlano()`

#### Plano e acesso → Recebimento  ·  `#pl-recebimento`
- **Pra que serve:** Cobrar por Pix ou cartão, e ver o que entrou — pelo Asaas.
- **O que tem:** indicadores: Aguardando, Confirmado, Disponível, Problemas · cartões: Por onde o dinheiro entra, Integração com o Asaas, Cobranças
- **Botões:** Trocar provedor, Salvar integração, Atualizar, Nova cobrança, Ver o Pix, Abrir a página de pagamento
- **Código da tela:** `backend/crm.html` → `S['pl-recebimento']  (" 'pl-recebimento':()=>" ou " pl-recebimento:()=>")`
- **Ações (funções JS):** `trocarProvedor()`, `salvarPagamentos()`, `buscarEm()`, `novaCobranca()`, `verPix()`
- **Rotas do servidor:** `/crm/api/pagamentos/config` → `backend/server.mjs`

#### Contrato  ·  `#contrato`
- **Pra que serve:** O que está valendo, desde quando, e quem aceitou.
- **O que tem:** indicadores: Em vigor, Versões, Aceites, Rascunho · cartões: Nada publicado ainda, Histórico de versões, Aceites registrados
- **Botões:** Escrever agora
- **Código da tela:** `backend/crm.html` → `telaDocumento('contrato')`
- **Ações (funções JS):** `editarDocumento()`

#### Política de uso  ·  `#politica`
- **Pra que serve:** Regras de uso, dados e privacidade — versionadas, com data de vigência.
- **O que tem:** indicadores: Em vigor, Versões, Aceites, Rascunho · cartões: Nada publicado ainda, Histórico de versões, Aceites registrados
- **Botões:** Escrever agora
- **Código da tela:** `backend/crm.html` → `telaDocumento('politica')`
- **Ações (funções JS):** `editarDocumento()`

#### Configurações  ·  `#config`
- **Pra que serve:** **central de integrações do Bolso Cheio** — o que está funcionando e o que falta pra funcionar (pedido do dono: "essa tela vai mostrar o que e fazer o que, tá morta").
- **O que tem:** resumo (funcionando · incompletas · desligadas) · grupos Canais de atendimento (WhatsApp Web, Telegram), Pagamentos (o provedor escolhido), Redes e loja (TikTok, Instagram, Loja e Google Shopping, Quebra-Galho), Avisos e e-mail (SMTP, alertas de segurança) · cada item com estado, motivo em português, **Testar** (pergunta ao serviço de verdade; e-mail manda um teste para o dono) e o botão para a tela onde se configura.
- **Parou:** o que já funcionou e deixou de funcionar vira faixa vermelha em todas as telas ("Uma integração parou"), até voltar ou o dono **dispensar**.
- **Saíram da tela:** Jira, Redmine, Azure DevOps, promptAudit, dashboard, Slack/CallMeBot e a governança de commit — eram do QA-Gate; `~/.qa-gate/company.json` continua intacto. Asaas/Meta oficial: o item Pagamentos mostra o provedor escolhido; a API da Meta (só licença) ficou de fora.
- **Código:** `backend/crm.html` → `telaIntegracoes()`, `faixaIntegracoes()`; `GET /crm/api/integracoes`, `GET /crm/api/integracoes/alerta`, `POST /crm/api/integracoes/testar|dispensar` → `engine/vsintegracoes` (`montar`, `comHistorico`, `dispensar`).
- **Prova:** `scripts/prova-integracoes.mjs` (13/13) · `tests/vsintegracoes.test.mjs`.

#### Perfil  ·  `#perfil`
- **Pra que serve:** O que a entrevista preencheu e o que a suíte usa disso.
- **O que tem:** cartões: Identificação, Ajustar, Regras em vigor
- **Botões:** Salvar
- **Código da tela:** `backend/crm.html` → `S['perfil']  (" 'perfil':()=>" ou " perfil:()=>")`
- **Ações (funções JS):** `salvarPerfil()`

---

## Histórico de pedidos

| Data | Pedido do dono | O que foi feito | Commit |
|---|---|---|---|
| 2026-09-25 | Painel fora do ar depois do reinício da máquina | Painel subido com `painel.env`; causa: painel não é serviço do sistema | — |
| 2026-09-25 | "Um dashboard com todos os menus, clica e aparece a página" | Itens **Loja e Google Shopping** e **Segurança** no menu (antes: loja só num aviso; segurança escondida dentro do Bot) | `70fc3b1` |
| 2026-09-25 | Login com velosobil@gmail.com ia pra tela de compra | E-mail do dono entra no dashboard com qualquer das duas senhas | `73eca71` |
| 2026-09-25 | Refinar atendimento do WhatsApp, respostas de sucesso/erro, botões, login; "modal horroroso" | Avisos fora do modal, botão trabalhando, confirmação compacta, `btn-d`, login enxuto, atendimento com avatar/busca/Enter envia | `70fc3b1` |
| 2026-09-25 | Modernizar com base nos layouts da pasta `VelosoSolution/Layouy` | Tema escuro neon (depois trocado pela paleta Navy) | `70fc3b1` |
| 2026-09-25 | "Rosa demais", ícones de cartão "mortos", cadê o Telegram | Menos rosa, ícone sem caixinha, **canal Telegram completo** (provider, menu próprio, atendimento, canal, auditor, consumo) | `70fc3b1` |
| 2026-09-26 | Proposta: Telegram que dá dinheiro + paleta Navy/Violeta/Esmeralda | **Resultados** (receita atribuída, oportunidades, campanhas), **Campanhas**, Consumo com bot × equipe, paleta aplicada | `70fc3b1` |
| 2026-09-26 | Topo mostrava "WhatsApp no ar" nas telas do Telegram | Tarja do topo pelo canal da tela; leads só do Telegram | `70fc3b1` |
| 2026-09-26 | 5 ajustes na tela Resultados + 3 microajustes | Receita "rei da tela" (largura dupla, 42px, tendência 14 dias), conversão sem "—", textos curtos, links viram botões, cabeçalho enxuto, "Por campanha" com estrutura | `70fc3b1` |
| 2026-09-27 | Commit + push | 3 commits enviados; doc em `DOC-6458.md` | `6c23af3` |
| 2026-09-27 | Desligar QA-Gate e MCP global | Bloqueado pela permissão do Claude Code (automodificação); comandos entregues pro dono rodar | — |
| 2026-09-27 | Criar este mapa mental | `docs/MAPA-MENTAL.md` | (este) |
| 2026-09-27 | Tela Atendimento v1 (modelo do dono: central cliente ↔ bot ↔ vendedor) | Situações e filtros, Assumir/Devolver, responder assume sozinho, cartão do pedido, marcos no histórico, atualização a cada 8 s sem perder o texto, selo Bot ativo; corrigidos: hora em UTC, filtros cortados, avatares iguais, aviso tapando o Enviar | (este) |
| 2026-09-27 | "Não carrega nada" no Atendimento do Telegram; Telegram ≠ WhatsApp; layout diferente, perguntar antes | Não era cache: bot ainda sem nenhuma mensagem (tela vazia). Dono escolheu **quadro de fila** → `telaFilaTelegram()` com painel lateral; WhatsApp intocado | (este) |
| 2026-09-27 | Fila mais completa sem perder a simplicidade (fase 2 do dono) | Resumo no topo, horário da última mensagem, tempo de espera com cor, Assumir no cartão; corrigido: painel fora da tela no celular, "agora" → "há menos de 1 min" | (este) |
| 2026-09-27 | Teste de volume (5 / 30 / 200 clientes simulados) | `scripts/teste-volume-telegram.mjs` com instância isolada + Telegram falso; achou e corrigiu: loja só com regras não punha a conversa na fila nem calava o bot | (este) |
| 2026-09-27 | Ver o teste acontecendo e ficar na tela | Modo `--ao-vivo` (clientes um a um no navegador, tudo fica no ar) + `--parar` | (este) |
| 2026-09-27 | Desligar ganchos de governança e MCP `vs-ia-dev` | Feito pelo Claude a pedido explícito do dono (backups `.bak-qagate`) | `f615d56` |
| 2026-09-27 | Telegram · Campanhas V1 (proposta do dono, MVP) | Assistente 4 passos + prévia Telegram + auditor por regras + aprovação → link + acompanhamento com entradas/conversas/pedidos/receita | `824ea6a` |
| 2026-09-27 | Controle e qualificação de leads nos dois canais, **sem IA** | Ficha por regras, matriz Tier 1/Tier 2, equipes = setores, carteira + rodízio, acesso de vendedor, cartão Oportunidade comercial | (este) |
| 2026-09-27 | Encerramento (cliente ou atendente) + avaliação + histórico para auditar, nos dois atendimentos, antes de voltar à Campanha | Protocolo em toda conversa, frases de despedida, nota 1–5 + comentário, encerrado sai da fila, tela Histórico com filtros e conversa; corrigido: "um atendente" virava "1 vendedor" na ficha | (este) |
| 2026-09-27 | Avisos de sucesso e erro ficavam na tela pra sempre (WhatsApp e Telegram) | Todos fecham sozinhos por relógio (erro mais devagar); causa do sucesso preso: "reduzir animações" escondia a barrinha e o `animationend` nunca vinha · botão Encerrar em toda conversa ativa | (este) |
| 2026-09-27 | Reinício do painel de produção (código das 01:35 → atual) · "encerrou a lista toda" e "não consegui avisar o cliente" | 8 conversas antigas sem protocolo sumiam da lista (voltaram); contato do WhatsApp por LID (`…@lid`) ficava sem endereço no protocolo aberto pelo painel → herda do atendimento anterior (`enderecoDe`) | (este) |
| 2026-09-27 | Fluxo do dono: fechar só quem assumiu; **Finalizar** ("algo mais?" → não → nota) × **Encerrar** (à força, com motivo, sem nota); cliente finaliza com motivo; histórico por desfecho | Botões desabilitados sem assumir, modal de motivo, "Esperando o cliente responder", colunas Desfecho · quem · motivo, filtros Finalizados/Encerrados à força/Pelo cliente | (este) |
| 2026-09-27 | Limpar a fila antiga do WhatsApp + tela sem atendimento não pode ficar vazia | 7 conversas antigas (20–21/09) **encerradas como limpeza, sem aviso** (backup `~/.qa-gate/backup-limpeza-20260927-041708`), protocolos marcados `legado` (histórico busca as mensagens antigas) · painel "Nenhum atendimento agora": bot, canal, equipe (quem está no painel) e o dia | (este) |
| 2026-09-27 | Separar atendimento humano por tier do comercial (1 tier hoje, até 5 para outras empresas) e não deixar tudo cair no bot por falta de dado | Campo Tier só para operador comercial, cartão Tiers do comercial, destino "Tier do comercial", pergunta de qualificação; padrão das regras trocado de equipes inexistentes para Tier 2 | (este) |
| 2026-09-27 | Horário de funcionamento com calendário (dia, hora início, hora fim) | Calendário semanal + datas especiais + feriados nacionais; horário passa a valer sem fluxo também. Prova `scripts/prova-horario.mjs` (11/11) | (este) |
| 2026-09-27 | Tela do Telegram mostrava coisas do WhatsApp (Micaela, equipe do WhatsApp) — "cada um vai ter seu próprio bot" | Bot por canal (config/regras/fluxo/horário próprios) + tela Telegram → Bot do Telegram; painel vazio do Telegram com dados do Telegram (ícone, bot do Telegram, quem atendeu pelo Telegram). Prova `scripts/prova-bot-telegram.mjs` (8/8) | (este) |
| 2026-09-27 | Voltar à Campanha: 2ª entrega da proposta | Destinos (evento do Telegram + cadastro manual + confirmação), publicar agora/agendar com botão do link, estados de publicação, política de frequência por destino, agendador | (este) |
| 2026-09-27 | Campanha aceitava qualquer texto/imagem ("MONTA PRA MIM" em Captar) → especificação do dono do auditor | Campos por objetivo, 3 resultados, pedido de ajuda, assistente sem inventar, estética como recomendação, evidências, revalidação no backend antes de publicar, reabrir. Prova 38/38 com o caso exato do dono | (este) |
| 2026-09-27 | "Criou a imagem mas não o texto" — criar automático tem que criar os dois | Assistente: "Criar texto e imagem"; resultado da auditoria: "Criar texto e imagem e auditar" (com dados completos); arte passa a usar só o informado (solução, benefício, ação) — tirada a frase inventada | (este) |
| 2026-09-27 | Canal e conexão: cliente coloca o bot nos canais e grupos dele | Cartão "Onde o bot trabalha" + "Adicionar destino" (canal · grupo · ID), confirmação automática do que o dono adiciona pelo painel; Campanhas só lista os liberados. Prova 43/43 | (este) |
| 2026-09-27 | Auditor gera histórico → tela com gráficos e valores para apresentar, "perto de como o mercado mostra auditoria" | Telegram · Auditor refeito: KPIs de mercado (TPR, TMA, SLA, CSAT, resolução pelo bot) com variação, 6 gráficos, log de auditoria com filtro/busca/CSV, Apresentar e Imprimir. Prova 36/36 | (este) |
| 2026-09-27 | Log de auditoria poluía a tela → acordeão | Log fechado por padrão, abre ao clicar (contagem de eventos no título); Exportar log funciona fechado. Prova 38/38 | (este) |
| 2026-09-27 | Auditor do WhatsApp na mesma pegada do Telegram, só com as informações do WhatsApp | `wa-auditor` passa a usar `telaAuditorCanal('whatsapp')`; texto do acordeão (Abrir/Fechar) acompanha o estado. Prova 40/40 | (este) |
| 2026-09-27 | Configurações estava morta (só QA-Gate) → central de integrações | Integrações reais com estado, motivo, teste e atalho; faixa "parou" em todas as telas; itens do QA-Gate fora da tela. Prova 13/13 | (este) |
| 2026-09-27 | Clientes e licenças: melhorar o layout + lugar para o dono pôr os preços + planos do Telegram | Aba Preços (planos por módulo + adendos, versão nova quando há cliente), Telegram Bronze/Prata/Gold, carteira com filtros/busca/valor/vencimento, cadastro com um plano por módulo e ciclo Mensal/Semestral, detalhe com etapas. Prova 20/20 | (este) |
| 2026-09-27 | Consumo com dados e valores reais; banda por cliente; passou → modo consulta + adendo de banda | Medidor geral (`engine/vsconsumo`), limite do plano + banda adicional, modo consulta (servidor 402 + canais sem envio + agendador parado), faixa de aviso em todas as telas, telas Telegram/WhatsApp · Consumo, pedido e liberação de banda. Prova 17/17 | (este) |
| 2026-09-27 | **Telas Telegram · Auditor e WhatsApp · Auditor FECHADAS** pelo dono | Padrão de mercado (KPIs, gráficos, log em acordeão, Apresentar/Imprimir/CSV), cada canal com os seus dados | (este) |
| 2026-09-27 | **Tela Telegram · Canal e conexão FECHADA** pelo dono | Conexão do bot + "Onde o bot trabalha" (adicionar canal, grupo ou pelo ID). Campanhas: o dono vai revisar mais a fundo depois | (este) |
| 2026-09-27 | **Tela Telegram · Atendimento FECHADA** pelo dono | Aprovada com o resultado do teste ao vivo. Teste de recebimento real (mensagem de um celular de verdade) fica pra depois, por escolha do dono (tempo da tela esgotado) | (este) |
| 2026-09-27 | "Clientes questionando o funil de vendas" → melhorar o funil (item 1 da proposta: funil que anda sozinho) | Funil automático sem IA: equipe respondeu → contato; pedido/cobrança → proposta com valor; pagamento confirmado → Ganho; lead parado → Esfriando; cartão de regras no CRM. Prova 21/21 | (este) |
| 2026-09-27 | "Visão geral deveria mostrar métricas, gráficos" — opção **A** (painel do negócio) | KPIs com variação, Precisa de atenção agora, 4 gráficos (leads por canal, funil, receita, bot × equipe), período 7/30/90, integrações compactas. Prova 18/18 | (este) |
| 2026-09-27 | "Visão geral só aparece isso — não vem dado algum" (rota de CRM desconhecida) | Não era a tela: o painel de produção rodava o código das 09:49. Reiniciado com `backend/reiniciar-painel.sh` (117 variáveis herdadas; Telegram e WhatsApp reconectaram); `/crm/api/visao` no ar | — |
| 2026-09-27 | Kwai é complicado igual TikTok? → "vou no básico, falta Insta, o resto é bônus" | Pesquisa: Kwai Shop só por ERP parceiro homologado, sem portal aberto. Decisão registrada: próxima rede = Instagram | — |
| 2026-09-27 | Como o catálogo entra na vitrine e nas integrações; como marcar vitrine | Explicado (Estoque → vitrine/Google automático; Meta/TikTok/ML por arquivo). Achado: vitrine só pelo 🛒 "Vender no canal" (reserva 1 unidade e, com TikTok ligado, deixa de marcar vitrine). Correção proposta, **não feita** | — |
| 2026-09-27 | "TikTok e rede social por último; Telegram ficou bom, QA vai dizer se os dados estão certos" | Prioridade registrada | — |
| 2026-09-27 | Vitrine: "ajuste mínimo tá suave" | Botão Pôr/Tirar da vitrine na linha do Estoque, sem reserva e sem TikTok. Prova 8/8 | (este) |
| 2026-09-27 | Site repaginado pra divulgar o Bolso Cheio (fora deste repo: `../Site`) | /bolso-cheio com identidade da marca, passos "1 · Peça a senha (Micaela) → 2 · Entre na demo", sem preço (sob orçamento), menu do topo parado, ☰ corrigido no celular; telefone antigo trocado (Micaela 553175536010 · comercial 31 97512-7978) | (este) |
| 2026-09-27 | "A Micaela tem que reconhecer e passar a chave de teste" | Fluxo de produção: opção 7 "Testar a demonstração" (+ termos senha/demo/acesso) manda link, usuário e senha; Micaela 24h (horário tirado). Código: cumprimento só quando a mensagem INTEIRA é cumprimento ("Olá! Quero a senha…" não é "oi"); na 1ª mensagem as opções levam os `termos` da planilha. Painel reiniciado | (este) |
| 2026-09-27 | "Tem usuário na tela também" | Demo com admin próprio `demo@velososolution.com.br` (`CONSOLE_ADMIN_EMAIL` em `subir-demo.sh`); e-mail pessoal do dono não entra mais na demo | (este) |
| 2026-09-28 | "Vale implementar o que falta pra esses mercados, principalmente orçamento" (distribuidoras, eventos, B2B, segurança eletrônica) | Orçamentos V1: montado na conversa (janela), enviado com PDF + link, aprovado pelo cliente, funil e Pix; tela Orçamentos; prova 28/28 | (a commitar) |
| 2026-09-28 | "Orçamento tem que vincular ao catálogo" + "volta minhas configurações da Micaela, tava correto" | Orçamento só com produto do catálogo (preço de lá); Micaela voltou ao fluxo e à config de 27/09 05:3x (sem a opção 7 da demo, com horário). Estado com demo guardado em `fluxo.com-demo-antes-de-voltar-202609281000.json` / `config.com-24h-antes-de-voltar-202609281000.json` | (a commitar) |
| 2026-09-28 | "Tenho que ter mais pra apresentar no fim do dia" (agro: produtor manda áudio) | **Áudio vira texto**: whisper.cpp local e gratuito (`~/.local/share/whisper.cpp`, modelo base, 127.0.0.1:8178, `backend/subir-transcricao.sh`); WhatsApp (`decryptFile`) e Telegram (`getFile`) entregam o áudio, `backend/canais.mjs` transcreve e segue como texto; falhou → segue como antes. ~7 s por áudio neste Xeon E5-2420 (só AVX; o "small" levaria ~30 s). Prova `node scripts/prova-audio.mjs <pasta>` 8/8 (Telegram falso). Teste `tests/vstranscricao.test.mjs` | (a commitar) |
| 2026-09-28 | "Deixa o principal e só coloca demo pros clientes, não ferra nosso sistema" | A demo estava usando os canais da produção: mesmo token do `@BolsoCheioVelosoBot` na casa da demo (os dois disputavam o bot → "outro programa está lendo este mesmo bot") e o login do WhatsApp da produção (553175536010), porque a sessão mora em `tokens/veloso`, fora da casa. Correção: `subir-demo.sh` com `WPP_SESSAO=demo`; trava `bloqueioDemo` em `backend/canais.mjs` (conectar, trocar número e retomada no boot); cópia do token da produção tirada da casa da demo. Teste `tests/canal-demo-isolamento.test.mjs` (6) | (a commitar) |
| 2026-09-28 | "Campanha pros lugares esquecidos" → "não estamos fazendo campanha, sim prospecção" | 6 campanhas "Interior · …" criadas e APROVADAS em Campanhas (Telegram), **nunca publicadas** — ficam até o dono dizer se tira. Tela **Prospecção de clientes**: plano aprovado (Fabiano Veloso — tech lead do projeto), 10 dias (28/09→07/10), meta 5 clientes, regiões MT/AM/RN/RS/RR, **13.342 empresas "na lista"** (Receita, agro principal), cadência dia 0/5/10, aviso "trocar abordagem" (5 sem resposta e nenhum retorno). Prova `scripts/prova-prospeccao.mjs`; teste `tests/vsprospeccao.test.mjs` | (a commitar) |
| 2026-09-28 | "Erradica essa merda vermelha: Uma integração parou — Loja e Google Shopping" | Loja sem produto na vitrine não conta como queda (`NAO_E_QUEDA` em `engine/vsintegracoes`) + aviso dispensado na produção | (a commitar) |
| 2026-09-28 | "Refina a tela, paginação 10/50/100, erradica o botão rosa" + "o botão ligar tem que sumir, o envio é automático" | Prospecção: **paginação** 10/50/100 (padrão 10, "página X de Y", anterior/próxima); **nada rosa** na tela (destaque verde, `.prosp-tela .btn-p`); nas etapas AUTOMÁTICAS (na lista, 1ª e 2ª mensagem) **nenhum botão de envio nem de ligação** — só o aviso "1ª mensagem automática por e-mail · envio ainda não ligado"; **"Ligar" (tel:) e WhatsApp só na vez de gente** (dia 10 vencido ou quem respondeu). O botão "WhatsApp · Nª mensagem" semi-manual (sessão segade-d6) saiu: contrariava a regra. Mantido dela: "Pediu pra sair" (LGPD, apaga e bloqueia por hash), alertas de qualidade, Histórico, Balanço + PDF. Prova `scripts/prova-prospeccao.mjs` 33/33; teste 10/10 | (a commitar) |
| 2026-09-28 | Fonte dos dados com link (feito na sessão segade-d6, a pedido do dono) | `FONTES` no engine (Receita → dados.gov.br + compartilhamento `YggdBLfdninEJX9`); `painel()` devolve `fontes`; chips no cabeçalho de "Empresas e contatos" (até 3 + "+N") e link curto por linha (`prospFontes()`, `prospFonteLinha()`). Links só aparecem depois do reinício do painel. Teste 11/11, prova 34/34 | (a commitar) |
| 2026-09-28 | "Além do portfólio, quero que vá essa mensagem… melhora e envia junto com o portfólio" + "É CEO, tá ótimo" + "bora 18" | **Aprovados pelo dono (nada enviado ainda):** `docs/prospeccao/portfolio-bolso-cheio-agro.pdf` (2 páginas, telas reais, só o que funciona, programa de parceiros; fonte HTML ao lado) e `docs/prospeccao/email-1a-mensagem.txt` (Fabiano Veloso, CEO da VDG Sistemas + Veloso Solution, 18 anos de estrada desde 2008; complementar ao sistema de gestão — "parceiro nos bastidores", sem dizer que é parceiro da TOTVS; indicação com percentual enquanto houver contrato; SAIR). Cópias de trabalho em `Prospeccao-Agro/`. Próximo: motor de envio por e-mail em lotes (dia 0 e dia 5), só com o "pode ligar" | (este) |
| 2026-09-28 | "Mata a segunda e vamos só em duas… WhatsApp última alternativa" + o texto do WhatsApp | Regra revista (ver Decisões do dono): e-mail no dia 0, WhatsApp de gente no dia 5 com o texto do dono, sem resposta encerra. **Envio do dia 0 pronto:** `backend/prospeccao-envio.mjs` (lotes, limite `PROSP_EMAIL_DIA` padrão 50/dia, pausa `PROSP_EMAIL_PAUSA_MS` 4 s, para em 3 recusas seguidas, "enviado" só com 250 do servidor), anexo do portfólio (`backend/email.mjs` ganhou `anexos` e `responderPara`), cartão "Envio automático por e-mail" só pro dono com "Ver o e-mail" e "Enviar lote" (confirmação). WhatsApp do dia 5 com o texto do dono ("WhatsApp · última tentativa"), depois "Sem resposta — encerrar". **Respostas prontas** (dono, 28/09): grosseria → desculpas + remove; "de onde veio meu número" → Receita/dados abertos, se incomodar apaga; sem interesse → agradece + apaga (as que encerram apagam e bloqueiam). Nada rosa nem nas janelas (`body.rota-prosp`). Prova 45/45 com SMTP falso; teste 12/12 | (este) |
| 2026-09-28 | "Coloca o menu Bot pra dentro de WhatsApp, ele pertence lá" | Menu: "Bot" saiu do topo; entrou no WhatsApp como "Bot — regras e comportamento" (`#bot-regras`) e "Bot — personalizar" (`#wa-personalizar`), como o "Bot do Telegram" mora no Telegram. `#bot` antigo continua abrindo (TITULO/PAI/SECAO) e o submenu abre sozinho por link | (a commitar) |

| 2026-09-28 | "Profissão pra cada bot… só escolher nome, foto e profissão, o resto nós fazemos… o máximo que ele escolhe é a forma que se porta: simpática, brincalhona, meio a meio" + escolheu o layout "b" | **Bot — personalizar** virou o assistente em 3 passos (quem é → como fala → pronto). 5 profissões × 3 jeitos de textos humanizados (`engine/vsbot/profissoes.mjs`); rota `/crm/api/bot/profissional`; "Ligar atendente" grava e troca foto/nome do número; fluxo intocado; texto por texto ficou no "Ajuste fino (avançado)". Teste 4/4, prova 21/21. Painel de produção reiniciado (a tela é lida na hora, a rota não) | (a commitar) |
| 2026-09-28 | "Pronto, agora preenche automático" (sim à proposta do fluxo pronto por profissão) | O assistente passou a montar o **fluxo** também: árvore pronta por profissão × jeito, com o **Estoque do cliente** por categoria; entra sozinho onde não há fluxo, troca só com a caixa marcada (com cópia). Sem cobrança automática (pedido vai pra gente). Corrigido "o Micaela" no fora do horário e a pergunta repetida na abertura. Teste 8/8, prova 35/35. Feito no worktree `bot-fluxo-6458` — **ainda não está no ar** (precisa trazer pro checkout e reiniciar o painel) | bot-fluxo-6458 |

---

## Pendências conhecidas

- **Vitrine:** ajuste mínimo feito — botão "Pôr na vitrine / Tirar da vitrine" na linha do Estoque (`porNaVitrine()`, sem reserva, sem TikTok). Ainda sem chave no formulário e sem coluna na importação; o 🛒 continua reservando 1 unidade (é do TikTok, fica pra quando as redes voltarem).
- **Instagram (depois de firmar a base — dono deixou redes por último):** existe só a autorização (`engine/vsinstagram/auth.mjs`: Login do Facebook → página → IG Business, escopos de publicar) sem rota, sem tela e sem app Meta aprovado. Falta: conectar pela tela, publicar/agendar post, receber DM no atendimento (fila como WhatsApp/Telegram) e Consumo/Resultados do canal.
- **Visão geral — limites da V1:** "Pedidos esperando pagamento" leva ao Resultados do Telegram (o WhatsApp ainda não tem tela de Resultados); TPR fica "—" até a equipe responder alguém que estava na fila.
- **Funil — próximos itens da proposta (não feitos, esperando o dono):** 2) motivo de perda obrigatório (lista fixa + gráfico); 3) métricas de funil (conversão etapa→etapa, tempo por etapa, previsão ponderada, canal × campanha); 4) quadro com arrastar e soltar + Tier/responsável no cartão + filtros; 5) próxima ação/lembrete por lead.
- **Funil — limites da V1:** cliente que já é Ganho e compra de novo não reabre o lead (continua Ganho; o pedido conta em Resultados); cobrança avulsa feita pela tela de Pagamentos (sem pedido do bot) não tem elo com o lead e não fecha nada; "pago" do gateway real ainda não foi provado ponta a ponta — a prova grava o pagamento confirmado no arquivo da instância isolada (caminho `sincronizarPagamentos`).
- **Lead do Telegram aparece com "telefone suspeito"** no CRM (id `999…` fora do padrão de celular) — cosmético, anterior.
- **Provas quebradas antes desta mudança:** `prova-qualificacao` trava esperando `.q-sim`; `prova-encerramento` 25/27 (textos das telas vazias). Iguais sem o funil automático.
- **Campanhas — depois da 2ª entrega:** valores da política de frequência que o dono propôs (texto cortado em "Intervalo sugerido") — hoje 4 h / 3 por dia; Telegram Ads (pago) fora; texto por IA só quando liberar custo; lote por planilha (3ª entrega).
- **Teste que depende de arquivo fora do repo:** `tests/vsbot-fluxo.test.mjs` → "o fluxo REAL da Micaela" lê `../Micaela/fluxo-atendimento-micaela-completo.csv`, que não existe mais nesta máquina.
- **Bot profissional — próximos:** catálogo da Micaela ainda com os 10 produtos a R$ 1,00 (teste; esperando os preços do dono); categoria nova no Estoque só entra no menu clicando "Ligar" de novo; Telegram ainda sem o assistente (tem bot próprio; fazer só se o dono pedir, canais separados); a foto só troca o número no WhatsApp Web (API oficial: WhatsApp Manager); Caixa (entradas/saídas, gráfico, documento) esperando o dono decidir "como quero me controlar".
- **Qualificação — próximos passos da proposta:** vendas concluídas pelo bot × por humano em Resultados; disponibilidade/região na distribuição; SLA e marcadores da fila (fases 3 e 4); campo "responsável" no Funil/Integração CRM. Ficha é por palavras: frases muito fora do padrão ficam "não informado".
- **Vendedor não vê o Resultados/Consumo** (só Atendimento) — decidir com o dono se vendedor ganha visão das próprias vendas.

- **Telegram sem mensagem real de cliente ainda** (Atendimento fechado sem esse teste, por decisão do dono em 2026-09-27; volume provado com o simulador) — provado com Telegram simulado; falta alguém escrever pro `@BolsoCheioVelosoBot`.
- **Receita atribuída depende de fluxo do bot com passo de cobrança** e gateway de pagamento no ar; sem isso a tela fica (corretamente) em R$ 0,00.
- **WhatsApp ainda sem tela de Resultados** — o motor (`engine/vsresultados`) já calcula por canal; falta só a tela.
- **Orçamento — o que ficou de fora da V1:** "repetir o último pedido" (distribuidoras), agenda de técnico (manutenção) e reserva por data (locadoras). Botão do WhatsApp provado só por código compartilhado com o Telegram — falta a prova com WhatsApp real conectado. Na demo os canais da produção são recusados (28/09): dá pra montar e baixar o PDF; "enviar" só funciona se a demo tiver canal próprio (outro bot, outro número).
- **Transcrição de áudio:** o servidor whisper NÃO é serviço do sistema (igual o painel): depois de reiniciar a máquina, subir `bash backend/subir-transcricao.sh`. Sem ele, áudio volta a ficar sem resposta (nada trava). Provado no Telegram (falso); o WhatsApp real (`decryptFile`) só com áudio de verdade do dono. A conversa guarda o texto transcrito sem marcar que veio de áudio.
- **Botão "Peça a senha" do site aponta pra Micaela**, mas a Micaela voltou pro fluxo sem a opção da demo (decisão do dono, 28/09): quem pedir a senha recebe o menu. Decidir: tirar o botão, pôr a senha no site, ou devolver só a opção da demo.
- **Preços de teste na produção:** WhatsApp Bronze R$ 0,50 e Prata R$ 1,00 em Clientes e licenças → Preços (padrão do código: 79 e 129). Quem assinar pelo painel paga centavos.
- **Micaela e o Ollama:** em 27/09, 3 de 4 chamadas passaram de 8 s e caíram nas regras; quando o dicionário não resolve, a resposta atrasa 8 s.
- **Telegram com horário** (seg–sex 10h–18h, fim de semana fechado) enquanto o WhatsApp atende 24h — decisão do dono.
- **Estratégia comercial da fase 1** (doc "Bolso Cheio — Estratégia comercial (fase 1)"): validar 5+ pagantes em 30 dias antes de investir em redes.
- **Demo (`demo.velososolution.com.br`) no ar de novo** (27/09, com usuário próprio) — antes estava fora desde o reinício — subir com `backend/subir-demo.sh` **só com credencial de teste** (o script herda o ambiente: não rodar com o `painel.env` carregado). **Canal próprio da demo ainda não existe:** pra cliente testar atendimento de verdade na demo, criar um bot só dela no @BotFather e, se for WhatsApp, parear OUTRO número na sessão `demo` — nunca o da Micaela.
- **Horário em UTC fora do Atendimento:** ~17 pontos do `crm.html` ainda formatam hora cortando o texto ISO (`slice(11,16)` / `slice(0,16)`) — Auditor, trilhas, retomada. Mostram 3 h adiantado no Brasil. Corrigido só no Atendimento.
- **WhatsApp → Atendimento recebeu a v1 junto (sem ter sido pedido):** revisar com o dono depois de fechar o Telegram — aproveitar o que faz sentido e tirar o resto.
- **Fila do Telegram — fases 3 e 4 do dono (não feitas):** marcadores (novo, pedido em andamento, pagamento pendente, cliente recorrente, urgente), filtro por status/atendente, atendente responsável, SLA; depois pedido/cliente/tags/histórico resumido/origem da campanha no cartão.
- **Atendimento v2 (fora da v1, por escolha do dono):** 3ª coluna com catálogo, pedidos anteriores, etiquetas e dados do cliente.
- **Indicadores de valor do bot** sugeridos na proposta (resolvidos sem humano, transferidos, vendas após atendimento): pertencem a Consumo/Resultados, não ao Atendimento — ainda não feitos.
- **"vendedor" não está nas palavras que chamam gente** (`PALAVRAS_HUMANO` em `engine/vsbot/regras.mjs`: atendente, humano, pessoa, falar com alguém, gerente, reclamação, cancelar). "Quero falar com um vendedor" só vai pra fila se a loja criar a regra. Decisão do dono se entra no padrão.
- **Avatar de nome com número** ("Cliente 001") vira "C0" — cosmético.
- **Avaliação — próximos passos possíveis:** média por vendedor/equipe em Resultados; alerta ao dono em nota ≤ 2; texto da pergunta configurável.
- **Teste intermitente:** `tests/vsresultados.test.mjs` → "conversa pelo link da campanha…" falhou 1 vez em 4 rodadas da bateria completa (passa sozinho). Observar.
- **Próxima tela do Telegram a trabalhar:** escolha do dono (Resultados, Atendimento e Canal e conexão fechados; Campanhas feita, dono revisa depois; Auditor fechado; Consumo feito (dono revisa)). Depois do Telegram: revisar o Atendimento do WhatsApp com o dono.

---

## ⏸ ONDE PARAMOS — ler isto primeiro ao voltar (2026-09-27, fim do dia)

> Ao voltar, o dono diz "lê o final do mapa e continua". Comece por aqui.

**Estado:** branch `fix/fabiano.veloso/6458`, tudo commitado e enviado. Painel de produção reiniciado com o código atual (WhatsApp e Telegram reconectam sozinhos com `backend/reiniciar-painel.sh`). Governança e MCP `vs-ia-dev` desligados a pedido do dono.

**Entregue hoje (ver Histórico):** Campanhas V1 + 2ª entrega + auditor pela especificação do dono · Qualificação e roteamento (tiers) · Encerramento (Finalizar × Encerrar), avaliação e Histórico · Bot por canal · Horário em calendário · Avisos que fecham sozinhos · Canal e conexão (destinos) · **Auditor** padrão de mercado (Telegram e WhatsApp, fechados) · **Consumo**: banda geral por instalação, modo consulta e adendo de banda · **Clientes e licenças**: aba Preços, planos do Telegram, carteira com filtros · **Configurações** virou central de integrações · 10 imagens de catálogo em `/home/veloso/Veloso/VelosoSolution/Catalogo` (geradas por código, sem IA) · rascunho da Política de uso (entregue no chat, não gravado).

**Pendências do dono (decidir/fazer):**
- **Contrato × modo consulta:** a cláusula 3.1 do contrato diz que, sem banda, só pausam mídia e publicações; o sistema entra em modo consulta (para tudo, inclusive o bot). Escolher: atualizar a cláusula OU o sistema pausar só mídia/publicações.
- **Política de uso:** revisar o rascunho (de preferência com advogado, item LGPD) e publicar em Política de uso.
- **Preços:** Telegram Bronze/Prata/Gold estão iguais aos do WhatsApp; preço do adendo de banda — tudo em Clientes e licenças → Preços. Desconto do semestral (10%) ainda não editável na tela.
- **Mercado Pago:** conferir em Configurações se falta o segredo de assinatura do webhook.
- **Telegram:** confirmar o canal "Teste campanha Bolso Cheio" em Canal e conexão; valor da política de frequência (hoje 4 h / 3 por dia); revisar Campanhas a fundo.
- **Google:** loja sem produto publicado (feed e sitemap vazios). Subir para o Google depende da conta Google do dono (Search Console + sitemap); aba Shopping tende a recusar serviço por assinatura e compra só por WhatsApp. Adiado por decisão do dono.

**Provas (instâncias isoladas):** `prova-integracoes` 13/13, `prova-clientes-precos` 20/20, `prova-consumo` 17/17, `prova-auditor` 40/40, `prova-campanhas` 40/40, `prova-qualificacao` 26/26, `prova-encerramento` 27/27, `prova-bot-telegram` 8/8, `prova-horario` 11/11. Suíte: 1558 ok, 1 falha conhecida (CSV da Micaela ausente nesta máquina).

**Como trabalhar (regra do dono):** implementar direto a V1 da proposta; perguntar só o absurdo, em TEXTO (nunca AskUserQuestion). Sem IA em recurso novo (custo). Tela de um canal não mostra dado do outro.
