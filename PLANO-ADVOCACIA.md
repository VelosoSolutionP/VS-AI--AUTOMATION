# Paulão — o bot da balança

Plano do sistema da Dra. Daynne, e do produto para vender ao mercado de advocacia.

Você não tinha requisitos para me passar, então fui levantar. Este documento é o
resultado: o que o mercado já faz, o que advogado odeia fazer, e onde dá para ir
além. Tudo que está marcado como **provado** eu testei nesta sessão.

---

## 1. A descoberta que decide o produto

### O que advogado mais odeia

A pesquisa de mercado bate sempre no mesmo lugar: advogado gasta **mais da metade do
dia em tarefa repetitiva**, não em trabalho intelectual. E o maior desperdício tem
nome:

> conferir publicação · atualizar planilha de prazos · repassar a atualização ao cliente

Some-se a isso WhatsApp (40% passam **mais de 2 horas por dia** nele) e e-mail (até
3 horas). É exatamente o território onde a gente já é bom.

E o medo por trás disso é um só: **perder prazo**. Prazo perdido vira processo
disciplinar na OAB e ação de indenização. É o único erro que ninguém relativiza.

### A fonte oficial é aberta, gratuita e ninguém está usando direito

O CNJ unificou os diários de justiça no **DJEN** — Diário de Justiça Eletrônico
Nacional. E ele tem **API pública, sem autenticação, que filtra por número da OAB**.

```
https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=105795&ufOab=MG
    &dataDisponibilizacaoInicio=2026-08-24&dataDisponibilizacaoFim=2026-09-23
```

**Provado nesta sessão, com dado real:** uma OAB de Minas devolveu **310
comunicações em 30 dias**, de vários tribunais, com número do processo, órgão, tipo
de comunicação, **texto completo da publicação** e link. Sem login, sem chave, sem
custo.

**Por que isso é grande:** o mercado inteiro revende isso. NextCase, Projuris,
Advise e companhia integram Escavador ou Judit, pagam por consulta e repassam no
plano — a partir de R$ 197/mês. Nós lemos **direto da fonte oficial do CNJ**, com
custo marginal **zero**.

Você perguntou se dá para ligar direto no JusBrasil. **Não** — o JusBrasil não tem
API pública aberta. Mas não precisa: o JusBrasil bebe da mesma fonte que está aberta
para nós. Ir direto ao CNJ é melhor do que integrar com o intermediário.

---

## 2. O que já existe e serve — sem construir nada

Rodando hoje, em produção, testado:

| Módulo | O que resolve para ela |
|---|---|
| `vsbot` + fluxo CSV | O Paulão. Árvore de triagem escrita em planilha |
| `vsprotocolo` | Número de atendimento, retomada em 24h, encerramento por silêncio |
| `vscrm` | Cliente, histórico, funil |
| `vsestoque` | **Tabela de honorários** — catálogo com preço que o bot lê na hora |
| `vspagamentos` | **Pix com QR na conversa**, cartão, webhook. Funciona desde ontem |
| `vsdocumentos` | Contrato e política, com versão e publicação |
| `vsoperadores` | Ela e o sócio; roteamento por área |
| `vsinfluence` | Campanhas, agenda de publicação, métricas |

Roteamento criminal → ela, trabalhista → o sócio é configuração de fluxo, não código.

---

## 3. O que é novo

### 3.1 Radar de publicações — a espinha dorsal

Todo dia de manhã, o sistema pergunta ao CNJ o que saiu no nome dela.

- Cada comunicação nova vira **item na mesa dela**, no WhatsApp
- O **prazo é extraído do texto** ("prazo de 15 dias", "5 dias úteis") e vira data
- **Contagem regressiva**: 3 dias antes, 1 dia antes, no dia
- Item só some da mesa quando **ela disser que tratou** — não some sozinho
- O **cliente daquele processo é avisado** que houve movimentação, sem juridiquês

Um detalhe que separa isto de planilha: **prazo não fecha sozinho por esquecimento**.
Se ninguém marcou como tratado, ele continua gritando.

### 3.2 Processos e a área do cliente

- Cadastro ligado ao cliente: número CNJ, vara, comarca, parte contrária
- Pelo WhatsApp, o cliente pede e recebe: **o número do processo dele**, o
  andamento em português, e o link de consulta
- Contratos, boletos e histórico de encerrados, quando ele quiser ver

*O cliente para de ligar para perguntar do processo.* É a segunda coisa que mais
consome o dia dela.

### 3.3 Audiências

- Cadastro com data, hora, vara, tipo
- **Aviso ao cliente**: uma semana antes, na véspera, na manhã do dia
- **Confirmação de leitura** — ela vê quem confirmou e quem sumiu
- Painel do dia: o que tem hoje e amanhã

No criminal, cliente que falta audiência é problema grave. Isto sozinho paga o
sistema.

### 3.4 Moderação

Como você pediu, com a trava que você mesmo colocou:

1. Palavrão na primeira vez → pede calma, uma vez, sem sermão
2. Na segunda → **encerra e silencia por 12 horas**
3. **Exceto** com contrato ativo — aí não encerra, marca para ela decidir. Cliente
   com contrato não pode ser calado por robô

Tudo com trilha: o que foi dito, quando, por que encerrou.

### 3.5 Portaria — golpista e invasão

- **Número desconhecido** entra por caminho curto: sem dado sensível, sem número de
  processo, sem documento. Só triagem e agendamento
- **Cliente conhecido** entra no atendimento completo
- **Limite por número novo** em janela de tempo, contra enxurrada
- **Palavras de golpe jurídico** (acordo urgente, precatório liberado, taxa para
  liberar valor, depósito judicial) alertam ela **e** avisam o cliente de que o
  escritório nunca pede depósito por WhatsApp

Ligado por padrão para ela; opcional para empresa, como você pediu.

### 3.6 Vigia do nome

Varredura periódica atrás do nome dela e do número da OAB em lugar público, avisando
quando aparecer onde não devia. Não promete achar tudo — promete olhar toda semana,
que é mais do que ela tem hoje.

### 3.7 Modo OAB no marketing

Publicidade de advogado é regulada (Código de Ética e Provimento 205/2021 do CFOAB).
Na prática, o que ela deve confirmar com a seccional:

| Pode | Não pode |
|---|---|
| Conteúdo informativo e educativo | Captação de clientela |
| Explicar direitos, prazos, como funciona | Prometer resultado |
| Divulgar áreas de atuação | **Anunciar honorários** |
| Impulsionar conteúdo informativo | Depoimento de cliente, caso identificável |

As 5 campanhas/mês passam por conferência antes de publicar: preço, promessa de
resultado, depoimento e termo mercantil **barram**, e o sistema **diz o que trocar**
em vez de só recusar. Guarda registro do que foi publicado, com data, para ela ter
defesa se alguém reclamar.

**Isto é diferencial de verdade.** Um marketing jurídico que impede a postagem que
dá processo na OAB vale mais que um que só publica — e é o que a amiga dela compra.

Repare na sutileza: o Paulão **pode** informar honorário no atendimento privado —
alguém perguntou, ele responde. O que não pode é **anunciar preço em publicidade**.
Dois canais, duas regras, e o sistema sabe a diferença.

### 3.8 Uma instalação por cliente

Cada escritório com a própria pasta de dados, porta e número de WhatsApp — o que a
demo já provou que funciona. Vira `subir-cliente.sh`. Sem isso, mexer no fluxo de um
derruba o do outro.

---

## 4. Onde a gente ganha de quem já está lá

O mercado em 2026 padronizou quatro coisas: monitoramento automático, IA para
redigir, portal do cliente e aplicativo. Todo mundo tem. Então o jogo não é ter —
é onde eles são fracos:

| Eles | Nós |
|---|---|
| Revendem Escavador/Judit, pagam por consulta | **Lemos o CNJ direto — custo zero** |
| Portal do cliente é site que ele não abre | **WhatsApp**, onde ele já está |
| Cobrança fora do sistema | **Pix com QR dentro da conversa** |
| Marketing genérico, ou nenhum | **Modo OAB**, que protege a inscrição dela |
| Nada contra golpe usando o nome do advogado | **Portaria e vigia do nome** |
| Bot de menu que não resolve | O que ela tem hoje: **paga caro e não faz nada** |

Esse último item é o seu melhor argumento de venda, porque é a dor dela: ela **já
paga** por um bot da Meta que não entrega. O comparativo se faz sozinho.

---

## 5. Ordem de construção

Cada fase entrega algo que ela usa sozinha.

**Fase 1 — o Paulão atendendo.** Triagem, roteamento pro sócio, honorários, Pix na
conversa, portaria, moderação. *Ela para de perder contato e de ser importunada.*

**Fase 2 — o radar de publicações.** A API do CNJ, a mesa de prazos, a contagem
regressiva, o aviso ao cliente. *É o coração, e é o que ninguém entrega barato.*

**Fase 3 — processos, audiências e área do cliente.** *O cliente para de ligar.*

**Fase 4 — marketing com modo OAB.**

**Fase 5 — vigia do nome e multi-instância.** *O que torna vendável às amigas.*

---

## 6. O que eu preciso — e não é de você

Você disse para não te perguntar. Então isto é para ela, e um áudio descrevendo um
atendimento do começo ao fim resolve quase tudo:

1. **Número da OAB e UF** — sem isso o radar não liga. É o único item bloqueante
2. Como ela atende hoje: o que o cliente pergunta primeiro, o que ela responde
3. Tabela de honorários atual, e a referência de mercado para os 30% abaixo
4. Qual sistema de processo ela usa, se usa
5. Número de WhatsApp do escritório, ou se vamos parear um novo
6. Áreas que o escritório atende, além de criminal e trabalhista

**Decisão minha, já tomada, para você não ter que escolher no chute:** a Fase 2
(radar) vem antes do marketing. Presença nas redes traz contato; prazo perdido tira
a inscrição. Primeiro a gente protege, depois a gente cresce.

---

## 7. O que eu não recomendo vender

**"Trago clientes."** O sistema dá presença, conteúdo constante e resposta imediata;
quem fecha contrato é ela. Além de arriscado comercialmente, é o discurso de
captação que a OAB veda — e respinga nela, não em nós.

O que vende, e é verdade:

> **Ela não perde prazo. O cliente não liga para saber do processo. Ninguém falta
> audiência.**

---

## 8. Sobre o sistema de vendas

Você disse que vai ter que montar a arquitetura do outro — a ponte e os controles
sobre 99, Zedelivery, Mercado Livre, Shopee e AliExpress, com o auditor em cima.
Posso montar. Mas em documento separado: misturar os dois é a receita para nenhum
dos dois ficar de pé.

Está anotado em `ONDE-PARAMOS.md`, seção 9, com tudo que você descreveu.

---

## Fontes

- [Advogados gastam mais tempo com tarefas repetitivas do que com produção intelectual](https://bernardodeazevedo.com/conteudos/advogados-gastam-mais-tempo-com-tarefas-repetitivas-do-que-com/)
- [Qual o melhor sistema para monitoramento de publicações — Projuris](https://www.projuris.com.br/blog/monitoramento-de-publicacoes/)
- [Melhor software jurídico 2026: comparativo — NextCase](https://nextcasebr.com/blog/melhores-softwares-juridicos-2026)
- [Principais APIs para consulta e monitoramento processual — Judit](https://judit.io/blog/api-judit/api-consulta-processual-monitoramento-processual-fornecedores-brasil-escavador-api/)
- [Comunicações Processuais — Portal CNJ](https://www.cnj.jus.br/programas-e-acoes/processo-judicial-eletronico-pje/comunicacoes-processuais/)
- [API do DJEN: consulta oficial do CNJ e como integrar](https://chatjuridico.com.br/api-do-djen-consulta-oficial-cnj/)
- [Documentação da API (Swagger) — CNJ](https://app.swaggerhub.com/apis-docs/cnj/pcp/1.0.0)
