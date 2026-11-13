# Banco compartilhado — site + Bolso Cheio (16/10/2026, Postgres desde 07/11)

Um banco só: **Postgres** (`zest-postgres`, Prisma, schema em `prisma/schema.prisma`).
Produção usa o banco `zest`, o painel local `zest_local`. SQLite foi aposentado em
12/11/2026 — não volta. O Bolso Cheio grava nele **separado por CNPJ** (e por loja, no
multi-loja). As tabelas do site (`solicitacoes`, `admins`, `indicacoes`,
`pagamentos`…) ficam como estão.

## Ligar

No `~/.qa-gate/console/painel.env` do painel:

```
DATABASE_URL=postgresql://usuario:senha@127.0.0.1:5434/zest?schema=public
VS_EMPRESA_CNPJ=53759232000194                                 # a empresa desta instalação
VS_EMPRESA_NOME=Veloso Solution
```

Sem `DATABASE_URL`, nada muda: cada módulo segue no JSON da casa (testes, demo).
Na primeira leitura, o JSON antigo entra no banco **uma vez, para uma empresa
só** (`bolso_migracoes`); o arquivo fica intacto como cópia.

## Tabelas do Bolso Cheio

| Tabela | Chave | Pra quê |
|---|---|---|
| `empresas` | `cnpj` | uma linha por empresa (CNPJ só dígitos) |
| `bolso_dados` | `cnpj, loja, modulo, nome` | o documento JSON que o módulo guardava em `<casa>/<modulo>/<nome>.json` |
| `catalogo_produtos` | `cnpj, loja, sku` | o catálogo achatado, uma linha por produto — **é o que o site lê** |
| `bolso_migracoes` | `arquivo` | qual JSON antigo já entrou, e pra qual empresa |

`catalogo_produtos`: `sku, nome, descricao, categoria, marca, preco_centavos,
preco_promo_centavos, quantidade, reservado, ativo, na_vitrine, imagem, link,
atualizado_em`. É reescrita a cada gravação do catálogo no painel; produto
apagado não entra.

## O site lendo o catálogo

```sql
SELECT sku, nome, preco_centavos, imagem, link
  FROM catalogo_produtos
 WHERE cnpj = $1 AND ativo AND na_vitrine
 ORDER BY nome;
```

Regra: **toda consulta do site filtra por `cnpj`**. Sem o filtro, uma empresa
veria o catálogo da outra.

O site só **lê** essas tabelas. Quem grava é o painel (é ele que confere
plano, limite de produtos e estoque).

Cópia diária: `backend/backup.mjs` faz `pg_dump -Fc` do `DATABASE_URL`
(volta com `pg_restore`).

## O que já está no banco e o que falta

- **No banco:** catálogo (`vsestoque`: produtos, movimentos, reservas, lotes).
- **Ainda no JSON da casa:** os outros módulos. Pra levar um módulo, troque o
  `load/save` dele por `banco.ler/gravar` (`engine/banco.mjs`), igual ao
  `engine/vsestoque/store.mjs`.
- **Multi-empresa de verdade** (vários CNPJs no mesmo painel) ainda precisa de
  login preso à empresa e de `VS_EMPRESA_CNPJ` por sessão em vez de por
  instalação — hoje é um CNPJ por instalação.

Código: `engine/banco.mjs` · teste `tests/banco-catalogo.test.mjs` (Postgres
descartável via `ZEST_PG_TESTE`).
