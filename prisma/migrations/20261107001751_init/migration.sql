-- CreateEnum
CREATE TYPE "TipoSolicitacao" AS ENUM ('parceria', 'orcamento', 'quebragalho');

-- CreateEnum
CREATE TYPE "StatusSolicitacao" AS ENUM ('pendente', 'aprovado', 'recusado');

-- CreateEnum
CREATE TYPE "StatusIndicacao" AS ENUM ('inscrito', 'analise', 'aprovado', 'recusado');

-- CreateTable
CREATE TABLE "empresas" (
    "cnpj" TEXT NOT NULL,
    "nome" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "bolso_dados" (
    "cnpj" TEXT NOT NULL,
    "loja" TEXT NOT NULL DEFAULT 'principal',
    "modulo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bolso_dados_pkey" PRIMARY KEY ("cnpj","loja","modulo","nome")
);

-- CreateTable
CREATE TABLE "catalogo_produtos" (
    "cnpj" TEXT NOT NULL,
    "loja" TEXT NOT NULL DEFAULT 'principal',
    "sku" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "categoria" TEXT,
    "marca" TEXT,
    "preco_centavos" INTEGER,
    "preco_promo_centavos" INTEGER,
    "quantidade" INTEGER,
    "reservado" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "na_vitrine" BOOLEAN NOT NULL DEFAULT false,
    "imagem" TEXT,
    "link" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogo_produtos_pkey" PRIMARY KEY ("cnpj","loja","sku")
);

-- CreateTable
CREATE TABLE "bolso_migracoes" (
    "arquivo" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "loja" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bolso_migracoes_pkey" PRIMARY KEY ("arquivo")
);

-- CreateTable
CREATE TABLE "solicitacoes" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoSolicitacao" NOT NULL,
    "status" "StatusSolicitacao" NOT NULL DEFAULT 'pendente',
    "cnpj" TEXT,
    "empresa" TEXT NOT NULL,
    "responsavel" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "assunto" TEXT,
    "site" TEXT,
    "mensagem" TEXT,
    "indicado_por" TEXT,
    "origem_ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL,
    "decidido_em" TIMESTAMP(3),
    "decidido_por" TEXT,
    "observacao" TEXT,

    CONSTRAINT "solicitacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "usuario" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "nome" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes" (
    "token" TEXT NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "indicacoes" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "empresa" TEXT,
    "social" TEXT,
    "status" "StatusIndicacao" NOT NULL DEFAULT 'inscrito',
    "post_url" TEXT,
    "zaps" INTEGER NOT NULL DEFAULT 0,
    "curtiu" INTEGER NOT NULL DEFAULT 0,
    "provas_em" TIMESTAMP(3),
    "premio_ate" TIMESTAMP(3),
    "indicado_por" TEXT,
    "origem_ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL,
    "decidido_em" TIMESTAMP(3),
    "decidido_por" TEXT,
    "observacao" TEXT,

    CONSTRAINT "indicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" SERIAL NOT NULL,
    "asaas_id" TEXT NOT NULL,
    "solicitacao_id" INTEGER,
    "cliente_asaas" TEXT,
    "descricao" TEXT,
    "forma" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "liquido" DOUBLE PRECISION,
    "taxa_plataforma" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "vence_em" TIMESTAMP(3),
    "pago_em" TIMESTAMP(3),
    "credito_em" TIMESTAMP(3),
    "link" TEXT,
    "pix_payload" TEXT,
    "ambiente" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_eventos" (
    "id" SERIAL NOT NULL,
    "evento_id" TEXT,
    "tipo" TEXT NOT NULL,
    "asaas_id" TEXT,
    "corpo" TEXT NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asaas_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalogo_produtos_cnpj_ativo_na_vitrine_idx" ON "catalogo_produtos"("cnpj", "ativo", "na_vitrine");

-- CreateIndex
CREATE INDEX "solicitacoes_status_criado_em_idx" ON "solicitacoes"("status", "criado_em");

-- CreateIndex
CREATE INDEX "solicitacoes_tipo_status_idx" ON "solicitacoes"("tipo", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admins_usuario_key" ON "admins"("usuario");

-- CreateIndex
CREATE INDEX "sessoes_expira_em_idx" ON "sessoes"("expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "indicacoes_codigo_key" ON "indicacoes"("codigo");

-- CreateIndex
CREATE INDEX "indicacoes_status_criado_em_idx" ON "indicacoes"("status", "criado_em");

-- CreateIndex
CREATE INDEX "indicacoes_email_idx" ON "indicacoes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_asaas_id_key" ON "pagamentos"("asaas_id");

-- CreateIndex
CREATE INDEX "pagamentos_status_criado_em_idx" ON "pagamentos"("status", "criado_em");

-- CreateIndex
CREATE INDEX "pagamentos_solicitacao_id_idx" ON "pagamentos"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_eventos_evento_id_key" ON "asaas_eventos"("evento_id");

-- CreateIndex
CREATE INDEX "asaas_eventos_asaas_id_recebido_em_idx" ON "asaas_eventos"("asaas_id", "recebido_em");

-- AddForeignKey
ALTER TABLE "bolso_dados" ADD CONSTRAINT "bolso_dados_cnpj_fkey" FOREIGN KEY ("cnpj") REFERENCES "empresas"("cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_produtos" ADD CONSTRAINT "catalogo_produtos_cnpj_fkey" FOREIGN KEY ("cnpj") REFERENCES "empresas"("cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
