# Produção fora da máquina do dono (18/10/2026)

Hoje o painel, o site e o túnel da Cloudflare rodam no computador do dono.
Caiu em 30/09 (máquina desligada) e de 14 a 16/10 (ligou sem internet). Com
clientes de parceiros, uma queda dessas derruba todos de uma vez.

## O que já roda sozinho (nesta máquina ou no servidor)

| O quê | Onde | Como |
|---|---|---|
| Religar canal caído | `canais.vigiarCanais`, a cada 1 min | WhatsApp oficial e Telegram tentam de novo; fora > 10 min → auditoria + **e-mail pro dono** |
| Cópia de segurança diária | `backend/backup.mjs`, depois das 3h | banco Postgres (pg_dump -Fc) + casa em .tar.gz, 600, últimos 14 dias em `~/backups-bolso/diario/`; falhou → e-mail |
| Aviso pro dono | `avisarDono` no server | e-mail para `ALERTA_EMAIL` (padrão: o e-mail do dono), no máximo 1 igual por hora |

## O que o dono precisa fazer

1. **Contratar o servidor.** VPS Ubuntu 24.04, 2 vCPU, 4 GB de RAM, 40 GB de disco, de preferência em São Paulo.
   Criar o usuário `veloso` com sudo e entrar por chave SSH.
2. **Monitor de fora** (o que avisa quando a máquina inteira cai — o painel não
   avisa da própria morte): uma conta grátis num monitor de disponibilidade
   olhando `https://bolsocheio.velososolution.com.br/health` a cada 5 min, com
   aviso por e-mail ou app.
3. **Cópia fora da máquina:** apontar `BACKUP_DESTINO` no `painel.env`. Exemplos:
   - Google Drive com rclone: `BACKUP_DESTINO="rclone copy {dir} drive:bolso-backups/{dia}"`
   - outro servidor: `BACKUP_DESTINO="rsync -a {dir} backup@IP:/backups/"`

## Mudar para o servidor

```
scripts/levar-para-servidor.sh preparar veloso@IP   # instala Node 22, cloudflared, copia código e dados; NÃO liga nada
scripts/levar-para-servidor.sh virar    veloso@IP   # para aqui, copia os dados de novo, liga lá (~1 min fora)
scripts/levar-para-servidor.sh voltar   veloso@IP   # se der errado: desliga lá e religa aqui
```

- Mesmo usuário e mesmos caminhos: os serviços (`bolso-painel-8787`,
  `velososolution-site`, `cloudflared-velososolution`) vão como estão.
- O túnel leva as credenciais junto: **o DNS não muda**.
- Depois de virar, reiniciar continua sendo `backend/reiniciar-painel.sh 8787`, agora no servidor.
- Conferir: health 200, `WhatsApp de volta no ar` e `Telegram de volta no ar` no `.painel.log`.

⚠ O script foi verificado só na sintaxe; a primeira execução contra um servidor
real deve ser acompanhada (o `preparar` não liga nada, dá pra repetir).
