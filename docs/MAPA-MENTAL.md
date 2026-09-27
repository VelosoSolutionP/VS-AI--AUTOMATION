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

---

## Telas

Os textos de "Pra que serve", cartões e botões foram **lidos do console rodando** (não escritos de memória). Busque o nome em "Código da tela" dentro de `backend/crm.html`.

### Operação

#### Visão geral  ·  `#visao`
- **Pra que serve:** O que está realmente ligado nesta instalação. Número que a suíte não tem aparece como “—”, nunca como zero.
- **O que tem:** indicadores: Leads abertos, Ganhos, Conversão, Whatsapp · cartões: Integrações, Sem fonte de dado ainda, Pra onde ir agora
- **Botões:** Atualizar, Cadastrar produto catálogo e publicação, Ligar uma rede conexões e credenciais, Ajustar o bot regras de resposta
- **Código da tela:** `backend/crm.html` → `telaVisao()`
- **Rotas do servidor:** `/crm/api/painel`, `/crm/api/status` → `backend/server.mjs`

#### Estoque  ·  `#estoque`
- **Pra que serve:** Cadastro de produto, saldo com reserva e exportação para os canais de venda.
- **O que tem:** indicadores: Produtos, Unidades, Valor parado, Sem saldo · cartões: Exportar para os canais, Lote de exportação por período, Publicações, Catálogo
- **Botões:** Baixar, Gerar lote, Tirar da vitrine, Atualizar, Importar, Exportar, Novo produto, PRODUTO ↑, PREÇO, ESTOQUE, STATUS, ATUALIZAÇÃO
- **Código da tela:** `backend/crm.html` → `S['estoque']  (" 'estoque':()=>" ou " estoque:()=>")`
- **Ações (funções JS):** `baixarFeed()`, `gerarLote()`, `tirarDaVitrine()`, `buscarNaTabela()`, `abrirImportar()`, `abrirExportar()`, `novoProduto()`, `ordenar()`, `verProduto()`, `editarProduto()`, `comprarProduto()`, `venderProduto()`, `excluirProduto()`
- **Rotas do servidor:** `/crm/api/estoque/excluir`, `/crm/api/estoque/lote`, `/crm/api/estoque/produto`, `/crm/api/estoque/vender`, `/crm/api/estoque/vitrine` → `backend/server.mjs`

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

#### Bot → Regras e comportamento  ·  `#bot-regras`
- **Pra que serve:** Atendimento automático: regras, respostas e quando chamar gente. Funciona aqui antes de ligar em qualquer canal.
- **O que tem:** indicadores: Regras, Chamam gente, Estado, Canal · cartões: Testar a conversa, Alguém pode ter entrado na conta do WhatsApp, Fluxo de atendimento, Regras, Como ele se comporta
- **Botões:** Enviar, Limpar, Baixar modelo, Apagar fluxo, Nova regra, Salvar
- **Código da tela:** `backend/crm.html` → `S.bot  (' bot:()=>')`
- **Ações (funções JS):** `simular()`, `baixarModeloFluxo()`, `apagarFluxo()`, `buscarEm()`, `novaRegra()`, `salvarBot()`
- **Rotas do servidor:** `/crm/api/bot/fluxo-apagar`, `/crm/api/bot/simular` → `backend/server.mjs`

#### Bot → Personalizar  ·  `#wa-personalizar`
- **Pra que serve:** Como o bot se apresenta e o que ele fala nas três horas que decidem tudo.
- **O que tem:** cartões: Como ele se apresenta, As três mensagens que decidem tudo, Foto e nome do número
- **Botões:** Salvar, Testar no simulador
- **Código da tela:** `backend/crm.html` → `S['wa-personalizar']  (" 'wa-personalizar':()=>" ou " wa-personalizar:()=>")`
- **Ações (funções JS):** `salvarPersonalizacao()`

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
- **O que tem:** indicadores: Abertos, Ganhos, Perdidos, Conversão · cartões: Onde os leads estão, Leads
- **Botões:** Atualizar, Novo lead, Abrir no WhatsApp, Marcar como ganho, Marcar como perdido
- **Código da tela:** `backend/crm.html` → `telaCrm()`
- **Ações (funções JS):** `buscarEm()`, `novoLead()`, `fechar()`
- **Rotas do servidor:** `/crm/api/fechar` → `backend/server.mjs`

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
- **Pra que serve:** Tudo que passou pelo WhatsApp: quem falou, quando, e por que o score deu o que deu.
- **O que tem:** indicadores: Eventos, Mensagens, Leads com trilha · cartões: Trilha
- **Botões:** Atualizar
- **Código da tela:** `backend/crm.html` → `auditorDoCanal('whatsapp')`
- **Ações (funções JS):** `buscarEm()`

#### WhatsApp → Consumo  ·  `#wa-consumo`
- **Pra que serve:** Quanta conversa passou por aqui, o que ela virou no funil — e o que só a fatura da Meta responde.
- **O que tem:** indicadores: Mensagens, Leads com conversa, Viraram venda, Custo · cartões: Por etapa do funil, Por mês, Por que o custo aparece como “—”
- **Código da tela:** `backend/crm.html` → `consumoDoCanal('whatsapp')`

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
- **Testes/prova:** `tests/vsauditoria.test.mjs` · `scripts/prova-auditor.mjs` (38/38). WhatsApp → Auditor continua o antigo (`auditorDoCanal`).

#### Telegram → Consumo  ·  `#tg-consumo`
- **Pra que serve:** Volume de conversa, quanto o bot resolveu sozinho e o que isso custa. O que virou dinheiro está em Resultados.
- **O que tem:** indicadores: Mensagens, Respondidas pelo bot, Respondidas pela equipe, Custo · cartões: Uso do bot, Mensagens por mês
- **Botões:** Ver resultados
- **Código da tela:** `backend/crm.html` → `consumoDoCanal('telegram')`


### Crescimento

#### Clientes e licenças  ·  `#clientes`
- **Pra que serve:** Quem comprou, o que foi liberado, e em que pé está cada um.
- **O que tem:** indicadores: Clientes, Ativos, Aguardando pagamento, Receita mensal · cartões: Carteira
- **Botões:** Novo cliente, Abrir
- **Código da tela:** `backend/crm.html` → `telaClientes()`
- **Ações (funções JS):** `novoCliente()`, `abrirCliente()`

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
- **Pra que serve:** Canais de aviso e integrações — com o que falta pra cada um funcionar.
- **O que tem:** cartões: Canais de aviso, Integrações, Governança
- **Código da tela:** `backend/crm.html` → `S['config']  (" 'config':()=>" ou " config:()=>")`

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
| 2026-09-27 | **Tela Telegram · Canal e conexão FECHADA** pelo dono | Conexão do bot + "Onde o bot trabalha" (adicionar canal, grupo ou pelo ID). Campanhas: o dono vai revisar mais a fundo depois | (este) |
| 2026-09-27 | **Tela Telegram · Atendimento FECHADA** pelo dono | Aprovada com o resultado do teste ao vivo. Teste de recebimento real (mensagem de um celular de verdade) fica pra depois, por escolha do dono (tempo da tela esgotado) | (este) |

---

## Pendências conhecidas

- **Campanhas — depois da 2ª entrega:** valores da política de frequência que o dono propôs (texto cortado em "Intervalo sugerido") — hoje 4 h / 3 por dia; Telegram Ads (pago) fora; texto por IA só quando liberar custo; lote por planilha (3ª entrega).
- **Teste que depende de arquivo fora do repo:** `tests/vsbot-fluxo.test.mjs` → "o fluxo REAL da Micaela" lê `../Micaela/fluxo-atendimento-micaela-completo.csv`, que não existe mais nesta máquina.
- **Qualificação — próximos passos da proposta:** vendas concluídas pelo bot × por humano em Resultados; disponibilidade/região na distribuição; SLA e marcadores da fila (fases 3 e 4); campo "responsável" no Funil/Integração CRM. Ficha é por palavras: frases muito fora do padrão ficam "não informado".
- **Vendedor não vê o Resultados/Consumo** (só Atendimento) — decidir com o dono se vendedor ganha visão das próprias vendas.

- **Telegram sem mensagem real de cliente ainda** (Atendimento fechado sem esse teste, por decisão do dono em 2026-09-27; volume provado com o simulador) — provado com Telegram simulado; falta alguém escrever pro `@BolsoCheioVelosoBot`.
- **Receita atribuída depende de fluxo do bot com passo de cobrança** e gateway de pagamento no ar; sem isso a tela fica (corretamente) em R$ 0,00.
- **WhatsApp ainda sem tela de Resultados** — o motor (`engine/vsresultados`) já calcula por canal; falta só a tela.
- **Cartão "Integrações" da Visão geral** conta "3 de 6" sem incluir o Telegram.
- **Visão geral diz "Estoque: nenhuma fonte conectada"** mesmo com produtos cadastrados (anterior a esta sessão).
- **Demo (`demo.velososolution.com.br`) fora do ar** desde o reinício — subir com `backend/subir-demo.sh` **só com credencial de teste** (o script herda o ambiente: não rodar com o `painel.env` carregado).
- **Horário em UTC fora do Atendimento:** ~17 pontos do `crm.html` ainda formatam hora cortando o texto ISO (`slice(11,16)` / `slice(0,16)`) — Auditor, trilhas, retomada. Mostram 3 h adiantado no Brasil. Corrigido só no Atendimento.
- **WhatsApp → Atendimento recebeu a v1 junto (sem ter sido pedido):** revisar com o dono depois de fechar o Telegram — aproveitar o que faz sentido e tirar o resto.
- **Fila do Telegram — fases 3 e 4 do dono (não feitas):** marcadores (novo, pedido em andamento, pagamento pendente, cliente recorrente, urgente), filtro por status/atendente, atendente responsável, SLA; depois pedido/cliente/tags/histórico resumido/origem da campanha no cartão.
- **Atendimento v2 (fora da v1, por escolha do dono):** 3ª coluna com catálogo, pedidos anteriores, etiquetas e dados do cliente.
- **Indicadores de valor do bot** sugeridos na proposta (resolvidos sem humano, transferidos, vendas após atendimento): pertencem a Consumo/Resultados, não ao Atendimento — ainda não feitos.
- **"vendedor" não está nas palavras que chamam gente** (`PALAVRAS_HUMANO` em `engine/vsbot/regras.mjs`: atendente, humano, pessoa, falar com alguém, gerente, reclamação, cancelar). "Quero falar com um vendedor" só vai pra fila se a loja criar a regra. Decisão do dono se entra no padrão.
- **Avatar de nome com número** ("Cliente 001") vira "C0" — cosmético.
- **Avaliação — próximos passos possíveis:** média por vendedor/equipe em Resultados; alerta ao dono em nota ≤ 2; texto da pergunta configurável.
- **Teste intermitente:** `tests/vsresultados.test.mjs` → "conversa pelo link da campanha…" falhou 1 vez em 4 rodadas da bateria completa (passa sozinho). Observar.
- **Próxima tela do Telegram a trabalhar:** escolha do dono (Resultados, Atendimento e Canal e conexão fechados; Campanhas feita, dono revisa depois; Auditor feito, dono revisa; resta Consumo). Depois do Telegram: revisar o Atendimento do WhatsApp com o dono.

---

## ⏸ ONDE PARAMOS — ler isto primeiro ao voltar (2026-09-27, fim do dia)

> Ao voltar, o dono diz "lê o final do mapa e continua". Comece por aqui.

**Estado:** branch `fix/fabiano.veloso/6458`, tudo commitado e enviado. Painel de produção reiniciado com o código atual (WhatsApp e Telegram reconectam sozinhos com `backend/reiniciar-painel.sh`). Governança e MCP `vs-ia-dev` desligados a pedido do dono.

**Entregue hoje (ver Histórico):** Campanhas V1 + 2ª entrega (destinos, publicar/agendar, política) + auditor pela especificação do dono (campos por objetivo, 3 resultados, assistente sem inventar, texto e imagem juntos, revalidação no backend, reabrir) · Qualificação e roteamento (tiers do comercial) · Encerramento (Finalizar × Encerrar), avaliação e Histórico · Bot por canal (Telegram → Bot do Telegram) · Horário em calendário · Avisos que fecham sozinhos · Tela sem atendimento.

**Próximo:** o dono vai "dar uma olhada mais a fundo" em Campanhas. Canal real de teste já conectado: **"Teste campanha Bolso Cheio"** (`-1003782351972`, privado, bot admin com permissão) — está **pendente** (entrou antes do botão novo), falta o dono clicar em Confirmar em **Telegram → Canal e conexão → Onde o bot trabalha**. Pendente dele também: o valor da política de frequência (hoje 4 h / 3 por dia).

**Provas (instâncias isoladas):** `prova-auditor` 38/38, `prova-campanhas` 40/40, `prova-qualificacao` 26/26, `prova-encerramento` 27/27, `prova-bot-telegram` 8/8, `prova-horario` 11/11.

**Como trabalhar (regra do dono):** implementar direto a V1 da proposta; perguntar só o absurdo, em TEXTO (nunca AskUserQuestion). Sem IA em recurso novo (custo). Tela de um canal não mostra dado do outro.
