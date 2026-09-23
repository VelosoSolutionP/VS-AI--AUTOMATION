# Paulão — o bot da balança

Plano para o sistema da Dra. Daynne, e para vender ao mercado de advocacia depois.

---

## 0. Duas travas para resolver ANTES de escrever código

Não são detalhe. As duas mudam o que pode ser construído.

### 0.1 Defensora pública ou advogada dativa?

Você disse: *"ela defensora publica entao atende pelo estado e ganha aquela miseria
por processo"*.

Essas são **duas coisas diferentes**, e a diferença é o plano inteiro:

- **Defensora pública de carreira** — concursada, recebe salário. A lei veda o
  exercício da advocacia privada fora das atribuições do cargo. Se for este o caso,
  **o escritório privado não pode existir**, e o sistema passa a servir só à
  organização do trabalho dela na Defensoria.
- **Advogada dativa / conveniada** — advogada privada nomeada pelo Estado, paga
  **por processo**. Pode ter escritório, sócio, cliente particular. O "ganha aquela
  miséria por processo" bate com esta.

Pela sua descrição — paga por processo, com sócio e escritório — aponta para
**dativa**. Precisa ser confirmado com ela, porque construir o errado aqui é
construir algo que ela não pode usar.

### 0.2 Publicidade de advogado é regulada

Você quer **5 campanhas por mês para trazer cliente, curtida e engajamento**. Isso
existe na advocacia, mas com regras próprias — o Código de Ética da OAB e o
Provimento 205/2021 do CFOAB. Na prática, o que eu entendo que vale (e que ela deve
confirmar com a seccional dela):

| Pode | Não pode |
|---|---|
| Conteúdo **informativo** e educativo | **Captação de clientela** — mercantilizar |
| Explicar direitos, prazos, como funciona | **Prometer resultado** ("ganho sua causa") |
| Divulgar áreas de atuação | **Anunciar honorários e forma de pagamento** |
| Impulsionar conteúdo informativo | Impulsionar anúncio de captação |
| Presença nas redes | **Depoimento de cliente**, caso concreto identificável |

**Consequência de produto, e é o diferencial:** um sistema de marketing jurídico
que **impede** a postagem que dá processo na OAB vale mais que um que só publica. É
isso que nenhum concorrente de "social media genérico" faz — e é o que a amiga dela
vai querer comprar.

Repare na tensão: o Paulão **pode** informar honorários no atendimento privado —
alguém perguntou, ele responde. O que não pode é **anunciar preço em publicidade**.
O sistema tem que saber a diferença entre esses dois canais. Vai saber.

---

## 1. O que já existe e serve — sem construir nada

Isto está rodando hoje, testado, em produção:

| Módulo | O que resolve para ela |
|---|---|
| `vsbot` + fluxo CSV | O Paulão. Árvore de triagem, escrita em planilha por quem entende do assunto |
| `vsprotocolo` | Número de atendimento, retomada em 24h, encerramento por silêncio |
| `vscrm` | Cliente, histórico de conversa, funil |
| `vsestoque` | **Tabela de honorários** — catálogo com preço, que o bot lê na hora |
| `vspagamentos` | **Pix com QR na conversa**, cartão, webhook. Funcionando desde ontem |
| `vsdocumentos` | Contrato e política, com versão e publicação |
| `vsoperadores` | Ela e o sócio como operadores; roteamento por setor |
| `vsinfluence` | Campanhas, agenda de publicação, métricas |
| `vsatendimento/conhecimento` | Base de respostas que engorda de atendimento resolvido |

**Roteamento que já dá para fazer hoje:** criminal → ela; trabalhista → o sócio;
fora das duas → informa que o escritório não atende. É configuração de fluxo, não
código novo.

---

## 2. O que é novo

### 2.1 Processos (o coração)

Cadastro do processo ligado ao cliente: número CNJ, vara, comarca, situação, parte
contrária, data de distribuição.

Para o cliente, pelo WhatsApp:
- **Número do processo** dele, quando ele pedir
- **Link de consulta** do andamento

Sobre o andamento, com honestidade: o **JusBrasil não tem API pública aberta** — dá
para montar o link de pesquisa, mas não para ler o andamento automaticamente. Quem
tem é o **DataJud, do CNJ**: API pública, gratuita, oficial, cobre os tribunais
brasileiros. É por ali que o andamento vira aviso automático. Preciso confirmar o
acesso antes de prometer.

### 2.2 Audiências — o que ela mais sente

No criminal, cliente que falta audiência vira problema grave. Então:

- Cadastro da audiência com data, hora, vara, tipo
- **Aviso ao cliente por WhatsApp**: uma semana antes, na véspera, e na manhã do dia
- **Confirmação de leitura** — ela vê quem confirmou e quem não respondeu
- Painel do dia: o que tem audiência hoje e amanhã

Isto sozinho já justifica o sistema para ela.

### 2.3 Moderação de atendimento

O que você pediu, com a trava que você mesmo colocou:

1. Palavrão na primeira vez → o Paulão pede calma, uma vez, sem sermão
2. Na segunda → **encerra o atendimento** e coloca em silêncio por **12 horas**
3. **Exceto** se houver contrato ativo com aquele cliente — aí não encerra, marca
   para ela decidir. Cliente com contrato não pode ser calado por um robô

Tudo registrado: o que foi dito, quando, e por que foi encerrado. Se ela precisar
justificar, tem a trilha.

### 2.4 Portaria — golpista e invasão

Ela sofre com isso direto. Então o primeiro contato passa por uma portaria:

- **Número desconhecido** entra por um caminho mais curto: sem dado sensível, sem
  número de processo, sem documento — só triagem e agendamento
- **Cliente conhecido** (já tem processo ou contrato) entra direto no atendimento
  completo
- **Limite de mensagens** por número novo em janela de tempo — corta enxurrada
- **Palavras de golpe** conhecidas no jurídico (acordo urgente, precatório liberado,
  taxa para liberar valor, depósito judicial) disparam alerta para ela **e** um aviso
  ao cliente de que o escritório nunca pede depósito por WhatsApp

Ligado por padrão para ela. Opcional para empresa — como você pediu.

### 2.5 Vigia do nome

Golpista usando o nome de advogado é praga. Uma varredura periódica procurando o
nome dela e o número da OAB em lugares públicos, e avisando quando aparecer onde
não devia. Não promete encontrar tudo — promete olhar toda semana e avisar o que
achar, que é mais do que ela tem hoje.

### 2.6 Modo OAB no marketing

As 5 campanhas por mês passam por uma conferência antes de publicar:

- Preço no texto → **barra**
- Promessa de resultado ("garanto", "ganho", "resolvo") → **barra**
- Depoimento, caso concreto identificável → **barra**
- Termo mercantil ("promoção", "desconto", "melhor advogada") → **barra**

Quando barra, **diz o que trocar** — não só recusa. E guarda o registro do que foi
publicado, com data, para ela ter defesa se alguém reclamar.

Você entra com as imagens; o texto o Paulão escreve, dentro dessas regras.

### 2.7 Uma instalação por cliente

Para vender às amigas dela, cada escritório precisa da **própria instalação** —
própria pasta de dados, própria porta, próprio número de WhatsApp. É o que a demo
já provou que funciona (`subir-demo.sh`). Vira `subir-cliente.sh`.

Sem isso, trocar o fluxo de um cliente derruba o do outro — a dança que fizemos a
noite toda com o Juarez.

---

## 3. Integrar com o que eles já usam

Postura de sempre: **somar, não substituir**. Escritório que já tem sistema de
processo (Astrea, Projuris, ADVBOX, SAJ) não vai trocar — e não precisa. O
diferencial é o que eles **não** fazem: atendimento no WhatsApp, cobrança na
conversa, aviso de audiência ao cliente, portaria contra golpe, marketing que não dá
processo na OAB.

Antes de prometer integração com qualquer um deles, preciso saber **qual ela usa** e
ver se tem API.

---

## 4. Ordem de construção

Cada fase entrega algo que ela usa sozinha. Nada de fase que só serve à seguinte.

**Fase 1 — o Paulão atendendo**
Triagem criminal, roteamento pro sócio, tabela de honorários, Pix na conversa,
portaria, moderação. *Ela para de perder contato de madrugada e para de ser
importunada por golpista.*

**Fase 2 — processos e audiências**
Cadastro, número do processo ao cliente, agenda de audiência, avisos por WhatsApp.
*É o que ela mais sente hoje.*

**Fase 3 — a área do cliente**
Contratos, boletos, histórico de processos encerrados — o cliente vê o que é dele,
quando quiser, sem ligar para ela.

**Fase 4 — marketing com modo OAB**
5 campanhas/mês, 5 serviços, texto automático, conferência antes de publicar.

**Fase 5 — vigia do nome e multi-instância**
O que torna vendável às amigas.

---

## 5. O que eu preciso para começar

**Dela:**
1. **Defensora de carreira ou dativa?** — a trava 0.1
2. Como ela atende hoje: o que o cliente pergunta primeiro, o que ela responde
3. Tabela de honorários atual — e a referência de mercado, para os 30% abaixo
4. Qual sistema de processo ela usa, se usa
5. Número de WhatsApp do escritório (ou se vamos parear um novo)
6. Número de inscrição na OAB — para o vigia do nome

**Sua:**
7. Confirmar o modelo comercial: grátis para ela, custos por sua conta, e o preço
   que vamos praticar com as amigas

Um áudio dela descrevendo um atendimento do começo ao fim resolve os itens 2 e 3 —
foi assim que o Juarez saiu do zero em uma hora.

---

## 6. O que eu não recomendo

**Prometer "trazer clientes".** O sistema pode dar presença, conteúdo constante e
resposta imediata. Quem fecha contrato é ela. Vender "trago clientes" para uma
advogada é, além de arriscado comercialmente, exatamente o discurso de captação que
a OAB veda — e que pode respingar nela, não em nós.

O que vende, e é verdade: **ela para de perder contato**, o cliente **para de ligar
para saber do processo**, e **ninguém falta audiência**.
