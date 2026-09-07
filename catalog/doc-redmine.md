# Padrão de Documentação para Redmine

Este documento define o padrão para documentar atividades de desenvolvimento no Redmine, separando Backend e Frontend mesmo em projetos monolíticos.

## Estrutura Padrão

### Backend (#NUMERO_TAREFA)

#### Descrição das Atividades Realizadas:

**Implementação:**

- Lista de funcionalidades implementadas
- Métodos criados/modificados com descrição
- Traits, factories, migrations adicionados
- Lógica de negócio implementada

**Validações de Negócio:**

- Regras de validação implementadas
- Condições de acesso/permissão
- Fluxos de aprovação
- Tratamento de erros

**Arquivos Modificados:**

- Lista completa de arquivos modificados com descrição das mudanças

**Arquivos Criados:**

- Lista completa de arquivos novos criados

**Testes Implementados:**

- Quantidade de testes automatizados
- Descrição dos casos de teste (CT001, CT002, etc.)
- Total de assertions
- Percentual de aprovação

---

### Frontend (#NUMERO_TAREFA)

#### Descrição das Atividades Realizadas:

**Implementação:**

- Componentes UI criados/modificados
- Filtros, formulários, tabelas implementados
- Configurações de layout e exibição
- Integrações com backend

**Validações de UX:**

- Regras de visibilidade de componentes
- Fluxos de interação do usuário
- Validações de formulário
- Feedback visual (notificações, loading states)

**Arquivos Modificados:**

- Lista completa de arquivos modificados com descrição das mudanças

**Componentes Utilizados:**

- Framework/biblioteca de componentes (ex: Filament, Livewire)
- Componentes específicos utilizados
- Métodos de configuração aplicados

**Melhorias de UX:**

- Otimizações de interface
- Recursos de acessibilidade
- Performance e responsividade
- Feedback e indicadores visuais

---

## Diretrizes Importantes

1. **Sempre separar Backend e Frontend** mesmo em monolitos
2. **Ser específico** nos nomes de métodos e arquivos
3. **Listar todas as validações** de negócio implementadas
4. **Documentar todos os testes** com casos de teste e assertions
5. **Usar linguagem clara** e objetiva
6. **Incluir métricas** (quantidade de testes, assertions, % aprovação)
7. **Descrever melhorias de UX** em detalhes no Frontend
