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
| Tela abre sem o menu lateral | Página ficou com a classe `sem-nav` do login. Trocar o `#` com o login aberto não desenha mais tela (guarda no `hashchange`). |
| Elemento que devia sumir fica aparecendo (caixa vazia) | CSS com `display:` anula o atributo `hidden`. Precisa de `.x[hidden]{display:none}` (já corrigido em `.pill` e `.g-dica`). |
| Volta pro login no meio do teste automatizado | Limite de 300 pedidos/minuto (`LIM_CRM`) estourado pelo robô. Uso normal não chega nisso. |
| Painel fora do ar depois de reiniciar a máquina | O painel **não é serviço do sistema** (o site e o túnel são). Subir com `bash backend/reiniciar-painel.sh` — se nada estiver rodando, subir do zero carregando `~/.qa-gate/console/painel.env`. |
| Login do dono cai em "Minha conta" / tela de compra | Corrigido: e-mail do dono entra como dono com qualquer uma das duas senhas (ver Decisões). |

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
engine/vspagamentos/ .... Mercado Pago / Asaas, estados do pagamento
engine/vsestoque/ ....... catálogo, vitrine, feeds (Google, Meta, TikTok)
backend/usuarios.mjs .... login, sessões, convites (dono × cliente)
```

**Onde ficam os dados (produção):** `~/.qa-gate/` (a "casa"). Ex.: `console/` (usuários, sessões, `painel.env`), `canais/` (config, `telegram.json` com o token — permissão 600), `vsresultados/`, `vspagamentos/`, `vsestoque/`. A demo usa outra casa: `~/.qa-gate-demo`.

**Endereços públicos:** `bolsocheio.velososolution.com.br` (console) · `painel.velososolution.com.br` (endereço antigo, mesmo painel — não tirar: está cadastrado na TikTok) · `demo.velososolution.com.br` (demonstração) · `velososolution.com.br` (site).

---

## Sistema visual e avisos (regras do console)

- **Tema padrão: escuro "Navy + Violeta + Esmeralda".** Superfícies (fundo, menu, cartões, avisos) em azul-marinho neutro; **violeta só na marca e na ação** (botão principal, item ativo, foco); **esmeralda no dinheiro e no sucesso**. O tema claro continua no botão Claro/Escuro. Tokens em `:root[data-theme="dark"]` no `crm.html`. Decidido pelo dono em 2026-09-26 (proposta de paleta dele).
- **Ícone de cartão é só o ícone** — sem caixinha, fundo nem brilho (a caixinha parecia botão e não era).
- **Avisos:** `flash(texto,'ok'|'err')`, `avisoOk(titulo,html)`, `avisoErro(titulo,html,motivos,acao)` → cartão no canto (função `toast`). **Sucesso some sozinho** (barrinha de tempo, pausa no mouse); **erro fica até fechar**. Aviso repetido não empilha. Com modal aberto, o aviso sobe pro topo (não tapa o Salvar). **Nunca usar modal pra dar recado** — erro em modal apagava o formulário aberto.
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
| Consumo × Resultados são telas separadas | menu Telegram | Consumo = quanto se conversou; Resultado = quanto virou dinheiro (é o que vende). |
| Financeiro fica **fora do menu** (a tela existe no código) | comentário em `GRUPOS` | Cada empresa controla caixa do seu jeito; genérico é pior que nada. |
| QA-Gate e MCP `vs-ia-dev` **desligados** por decisão do tech lead (2026-09-27) — ele vai refatorar | fora do repo (`~/.claude/settings.json`, `~/.claude.json`) | "Não é funcional." Ausência de recibo do gate não é bloqueio enquanto valer. |
| Postura de produto: **somar** ao que o cliente já tem, nunca substituir o sistema dele | — | Diretriz geral do dono. |

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
- **Pra que serve:** Ninguém esperando — Joel está dando conta.
- **Botões:** Conectar o WhatsApp, Conectar agora, R Robson 21/09 Veloso, W WhatsApp 21/09 [outro], Enviar
- **Código da tela:** `backend/crm.html` → `telaAtendimento('whatsapp')`
- **Ações (funções JS):** `buscarConversa()`, `abrirConversa()`, `crescerResposta()`, `responderCliente()`
- **Rotas do servidor:** `/crm/api/atendimentos`, `/crm/api/atendimentos/devolver`, `/crm/api/atendimentos/encerrar`, `/crm/api/atendimentos/responder` → `backend/server.mjs`

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
- **Pra que serve:** Quem escreve no Telegram aparece aqui.
- **Código da tela:** `backend/crm.html` → `telaAtendimento('telegram')`
- **Rotas do servidor:** `/crm/api/atendimentos`, `/crm/api/atendimentos/devolver`, `/crm/api/atendimentos/encerrar`, `/crm/api/atendimentos/responder` → `backend/server.mjs`

#### Telegram → Resultados  ·  `#tg-resultados`
- **Pra que serve:** Quanto o Telegram colocou no seu bolso. Só conta venda com pagamento confirmado.
- **O que tem:** indicadores: Receita atribuída, Pedidos concluídos, Leads atendidos, Conversão · cartões: Sua primeira venda pelo Telegram em 3 passos, Oportunidades de retomada, Por campanha
- **Botões:** 7 dias, 30 dias, 90 dias, Abrir bot, Abrir fluxo do bot, Criar campanha, Ver campanhas
- **Código da tela:** `backend/crm.html` → `telaResultados('telegram')`
- **Ações (funções JS):** `trocarPeriodo()`
- **Rotas do servidor:** `/crm/api/resultados`, `/crm/api/resultados/retomar` → `backend/server.mjs`

#### Telegram → Campanhas  ·  `#tg-campanhas`
- **Pra que serve:** Um link por divulgação. Quem entra pelo link chega com a campanha marcada — e a venda que sair dali é creditada a ela.
- **O que tem:** cartões: Nova campanha, Campanhas ativas (0)
- **Botões:** Criar link
- **Código da tela:** `backend/crm.html` → `telaCampanhas('telegram')`
- **Ações (funções JS):** `criarCampanhaUI()`
- **Rotas do servidor:** `/crm/api/resultados`, `/crm/api/resultados/campanha`, `/crm/api/resultados/campanha/arquivar` → `backend/server.mjs`

#### Telegram → Canal e conexão  ·  `#tg-canal`
- **Pra que serve:** O bot do Telegram atende com o mesmo robô, o mesmo funil e a mesma fila do WhatsApp.
- **O que tem:** indicadores: Estado, Bot, Conversas, Última atividade · cartões: Seu bot está no ar
- **Botões:** Desconectar, Copiar link, Trocar o token
- **Código da tela:** `backend/crm.html` → `telaTelegram()`
- **Ações (funções JS):** `desconectarTelegram()`
- **Rotas do servidor:** `/crm/api/canais/conectar`, `/crm/api/canais/desconectar`, `/crm/api/canais/telegram` → `backend/server.mjs`

#### Telegram → Auditor  ·  `#tg-auditor`
- **Pra que serve:** Tudo que passou pelo Telegram: quem falou, quando e o que o bot respondeu.
- **O que tem:** indicadores: Eventos, Mensagens, Leads com trilha · cartões: Trilha
- **Botões:** Atualizar
- **Código da tela:** `backend/crm.html` → `auditorDoCanal('telegram')`
- **Ações (funções JS):** `buscarEm()`

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

---

## Pendências conhecidas

- **Telegram sem mensagem real de cliente ainda** — provado com Telegram simulado; falta alguém escrever pro `@BolsoCheioVelosoBot`.
- **Receita atribuída depende de fluxo do bot com passo de cobrança** e gateway de pagamento no ar; sem isso a tela fica (corretamente) em R$ 0,00.
- **WhatsApp ainda sem tela de Resultados** — o motor (`engine/vsresultados`) já calcula por canal; falta só a tela.
- **Cartão "Integrações" da Visão geral** conta "3 de 6" sem incluir o Telegram.
- **Visão geral diz "Estoque: nenhuma fonte conectada"** mesmo com produtos cadastrados (anterior a esta sessão).
- **Demo (`demo.velososolution.com.br`) fora do ar** desde o reinício — subir com `backend/subir-demo.sh` **só com credencial de teste** (o script herda o ambiente: não rodar com o `painel.env` carregado).
- **Próxima tela do Telegram a trabalhar:** escolha do dono (sugestão: Campanhas).
