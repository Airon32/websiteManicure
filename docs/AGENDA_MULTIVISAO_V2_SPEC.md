# ESPECIFICAÇÃO DE PRODUTO E UX — AGENDA MULTIVISÃO V2 & REDESIGN DA AGENDA PESSOAL
**DE:** VP STRATEGY & INTELLIGENCE  
**PARA:** AI CENTRAL (COMMANDER) & VP ENGINEERING  
**DATA:** 16 de Agosto de 2026  
**PROJETO:** Mary Esmalteria Web App  
**STATUS:** APROVADO PARA IMPLEMENTAÇÃO (FASE 1 CONCLUÍDA)

---

## 1. SUMÁRIO EXECUTIVO & DIAGNÓSTICO ESTRATÉGICO

### 1.1 Objetivo da Evolução
A Mary Esmalteria opera em um modelo híbrido de alta rotatividade: recepção/gestão administrativa centralizada e profissionais autônomas/colaboradoras que utilizam a agenda em smartphones e tablets na bancada de atendimento.

A versão atual da **Agenda Administrativa (Modo Dia)** atingiu maturidade operacional e está **100% aprovada**. Contudo, identificamos dois gargalos severos de experiência e negócio:
1. **Desperdício de Espaço na Agenda Pessoal dos Colaboradores**: O sistema herdava a lógica de grid multi-colunas (`grid-cols-2`), forçando uma coluna de 50% de largura e deixando uma área inútil e vazia de 50% à direita no dispositivo da manicure logada.
2. **Ausência de Perspectiva Temporal Ampla (Semana e Mês)**: Dificuldade de prever ocupação futura, planejar folgas, identificar dias de pico e consultar faturamento semanal/mensal acumulado.

A **Agenda Multivisão V2** soluciona esses pontos introduzindo o seletor compacto `[ DIA | SEMANA | MÊS ]` e reestruturando a **Agenda Pessoal** para ocupar **100% da largura útil disponível**, mantendo o rigor estético dark/pink e a conformidade total com as diretrizes de privacidade LGPD.

---

## 2. DIAGNÓSTICO COMPARATIVO: AGENDA ADM vs. AGENDA PESSOAL

| Dimensão | Agenda ADM (Visão Geral) | Agenda Pessoal Atual (Gargalo) | Agenda Pessoal V2 (Especificação) |
| :--- | :--- | :--- | :--- |
| **Público-Alvo** | Proprietária / Recepção | Manicure / Pedicure logada | Manicure / Pedicure logada |
| **Colunas Visíveis** | N profissionais ativas lado a lado | 1 profissional em grid de 2 colunas | **1 profissional em largura total (100%)** |
| **Aproveitamento Útil** | 100% (distribuído entre equipe) | ~50% (50% de espaço morto à direita) | **100% (calc(100% - time_col_width))** |
| **Legibilidade Mobile** | Boa para 2 prof., scroll para >2 | Comprometida (cards espremidos sem motivo) | **Máxima (cards largos, texto legível)** |
| **Ações Rápidas** | Confirmar, Concluir, Mover, Bloquear | Idem, mas com botões apertados | **Ergonomia touch otimizada (44x44px target)** |
| **Modos de Visão** | Apenas Diário | Apenas Diário | **DIA, SEMANA (7 dias) e MÊS (30 dias)** |
| **Privacidade LGPD** | Acesso a contatos conforme role | Telefone mascarado (🔒) mantido | **Telefone mascarado (🔒) mantido** |

### 2.1 Causa Raiz do Problema de Espaço Identificada no Código
No componente atual `AgendaTimeline.jsx`:
```javascript
// CÓDIGO ANTERIOR COM FALHA ESTRUTURAL
const isTwoProfessionals = visibleProfessionals.length <= 2;
// Quando visibleProfessionals tem tamanho 1 (colaborador logado):
// isTwoProfessionals avaliava como TRUE e aplicava a classe CSS:
<div className="grid grid-cols-2">
  {/* Apenas 1 coluna renderizada -> 50% de espaço fantasma vazio */}
</div>
```
**Diretriz de Correção para Engenharia**: O layout deve calcular dinamicamente a estrutura de grid/flex:
- Para `visibleProfessionals.length === 1`: O container de agendamentos assume `w-full flex-1 flex flex-col`, sem grid multi-colunas artificial.

---

## 3. ARQUITETURA DA INFORMAÇÃO & INTERAÇÕES DA MULTIVISÃO V2

```mermaid
graph TD
    A[Barra Superior da Agenda] --> B[Seletor Compacto: DIA | SEMANA | MÊS]
    A --> C[Navegador de Datas: < Anterior | Data Atual | Próximo >]
    A --> D[Botão Rápido: HOJE]
    
    B -->|Modo DIA| E[Timeline Diária Vertical]
    B -->|Modo SEMANA| F[Grade Semanal 7 Dias]
    B -->|Modo MÊS| G[Calendário Mensal Matricial]
    
    E --> E1[ADM: Multi-Profissionais Lado a Lado]
    E --> E2[Pessoal: 100% Largura Útil para o Colaborador]
    
    F --> F1[ADM: Visão Semanal da Equipe ou Profissional Filtrado]
    F --> F2[Pessoal: 7 Colunas SEG-DOM da Profissional]
    
    G --> G1[Células com Métricas: Agendamentos, Bloqueios e Status]
    G -->|Clique no Dia| E[Alterna Automaticamente para o Modo DIA na Data]
```

---

## 4. ESPECIFICAÇÃO DETALHADA DOS MODOS DE VISUALIZAÇÃO

### 4.1 MODO DIA (Day View) — *Refinamento Ergonômico*
- **Objetivo**: Execução operacional minuto a minuto no salão.
- **Eixo Temporal Vertical**:
  - Slots de 30 minutos com altura exata de `64px` (`PIXELS_PER_30_MINUTES = 64`).
  - Intervalo dinâmico calculado por `getTimelineBounds` (ex: 08:00 às 20:00).
  - Marcador de Linha **AO VIVO**: Fita horizontal com gradiente neon rosa/vermelho e indicador pulsante na posição `minuteToPixels(now)`.
  - Sobreposição de horário fora de expediente (`ScheduleOverlay`): Fundo escurecido semitransparente (`bg-black/35 backdrop-blur-[1px]`) delimitando o início/fim de expediente cadastrado.
- **Estrutura na Agenda Pessoal**:
  - Coluna de Horário fixa na esquerda: `w-12 md:w-16` (`48px` mobile, `64px` desktop).
  - Coluna da Profissional: `flex-1 w-full` (ocupando todos os `342px` restantes em viewport de `390px` e `1376px` em desktop `1440px`).
  - **Card de Agendamento Largo**:
    - Linha 1: Tag de horário `[ 09:00–10:00 ]` + Badge de Status (`Confirmado` / `Concluído` / `Preço`).
    - Linha 2: Nome da Cliente em destaque (`text-sm font-black uppercase tracking-wide`).
    - Linha 3: Nome do Serviço + Duração (`text-xs text-muted`).
    - Linha 4 (Rodapé de Ações Rápidas): Botão WhatsApp (se permitido), Confirmar Presença, Concluir/Pago, ou Desbloquear.
- **Estrutura na Agenda ADM**:
  - Preserva o comportamento aprovado: 2 profissionais em `grid-cols-2` perfeitamente ajustadas, e >2 profissionais com scroll horizontal suave e cabeçalhos fixos.

---

### 4.2 MODO SEMANA (Week View) — *Planejamento Operacional*
- **Objetivo**: Visão consolidada da semana inteira de trabalho (Segunda a Domingo ou Domingo a Sábado).
- **Estrutura Visual**:
  - Header da Semana: 7 colunas de dias com identificação do dia da semana (`SEG 10`, `TER 11`, `QUA 12`...), contador de agendamentos diários e badge de faturamento do dia.
  - Grade Temporal: Eixo de horas vertical à esquerda sincronizado com todas as 7 colunas.
- **Agenda Pessoal na Semana**:
  - As 7 colunas pertencem exclusivamente à profissional logada.
  - Permite identificar instantaneamente buracos na agenda, dias lotados e horários de pico.
- **Agenda ADM na Semana**:
  - Filtro por profissional ativo no topo: `[ Todos os Profissionais ]` ou `[ Mariana ]` / `[ Carla ]`.
  - Quando um profissional é selecionado: visualiza a semana completa daquele profissional.
  - Quando "Todos" está selecionado: cards agregados por horário em cada dia com indicador da cor da profissional.
- **Comportamento Mobile (390px / 412px)**:
  - Para evitar espremer 7 colunas em 390px (o que geraria colunas ilegíveis de ~48px):
  - **Scroll horizontal controlado**: Cada coluna de dia tem largura mínima de `120px` a `135px` no mobile.
  - A coluna de HORA permanece `sticky left-0 z-40`.
  - O usuário faz swipe horizontal suave para navegar entre Seg, Ter, Qua, Qui, Sex, Sáb, Dom.
  - Botões no cabeçalho: `[ < Semana Anterior ] [ Semana 33 (10–16 Ago) ] [ Próxima Semana > ]` e botão `[ HOJE ]` para rolar instantaneamente para o dia atual.
- **Comportamento Desktop (1440px)**:
  - 7 colunas distribuídas igualmente com `grid grid-cols-7` em 100% da largura útil sem necessidade de scroll horizontal.

---

### 4.3 MODO MÊS (Month View) — *Visão Macro & Faturamento*
- **Objetivo**: Monitoramento macro de capacidade, agendamentos futuros, feriados e dias de alta demanda.
- **Estrutura Visual (Grade 7x5 ou 7x6)**:
  - Dias da semana no topo: `DOM`, `SEG`, `TER`, `QUA`, `QUI`, `SEX`, `SÁB`.
  - Célula de cada dia:
    - Número do dia no canto superior direito (com badge circular rosa neon no dia de `Hoje`).
    - Destaque sutil para dias com agendamentos (`bg-card/70 border-border/60 hover:border-primary/50`).
    - Dias pertencentes a outros meses: `opacity-25 pointer-events-none`.
- **Indicadores Resumidos dentro da Célula**:
  1. **Pílula de Ocupação/Contagem**: Ex: `5 agend.` (em verde se > 0) e `1 bloq.` (em âmbar).
  2. **Bolinhas de Status**: Até 4 pontos luminosos coloridos indicando o status dos agendamentos do dia (🟢 Confirmado, 🟣 Concluído, 🌸 Agendado, 🟡 Bloqueado).
  3. **Receita Prevista/Realizada (Desktop/Tablet)**: Ex: `R$ 420` em verde sutil no rodapé da célula.
- **Regra de Interação Fundamental**:
  - **Clique no Dia**: Ao clicar em qualquer célula de dia do mês, o sistema dispara a ação:
    ```javascript
    const handleMonthDayClick = (dayDate) => {
      setSelectedDate(dayDate);
      setViewMode('dia'); // Navega automaticamente para a visualização diária detalhada
    };
    ```
  - Isso garante fricção zero: o colaborador ou gestor bate o olho no mês, clica na sexta-feira dia 21 e entra imediatamente na timeline diária daquele dia.

---

## 5. SELETOR DE VISUALIZAÇÃO (VIEW MODE SWITCHER)

### 5.1 Especificação do Componente
O seletor deve ser extremamente compacto, elegante e posicionado estrategicamente na barra de controle da Agenda:

```
+-----------------------------------------------------------------------------------+
|  [ < ]  16 de Agosto, 2026  [ > ]   [ HOJE ]    |  [ DIA ] [ SEMANA ] [ MÊS ]  |   |
+-----------------------------------------------------------------------------------+
```

- **Tokens e Estilos**:
  - Container: `inline-flex p-1 rounded-xl bg-card/90 border border-border/70 backdrop-blur-md shadow-inner`
  - Botão Inativo: `px-3 py-1.5 rounded-lg text-xs font-black uppercase text-muted hover:text-foreground hover:bg-white/5 transition-all`
  - Botão Ativo: `px-3 py-1.5 rounded-lg text-xs font-black uppercase text-white bg-primary shadow-md shadow-primary/30 transition-all glow-primary`
- **Acessibilidade**:
  - `role="radiogroup"` ou `role="tablist"` com `aria-label="Modo de visualização da agenda"`.
  - Navegável via teclado (`Tab`, setas esquerda/direita, `Space`/`Enter`).

---

## 6. DESIGN SYSTEM, CORES & HIERARQUIA VISUAL (MARY ESMALTERIA)

| Elemento | Token Tailwind / CSS | Propriedade Visual | Justificativa de UX |
| :--- | :--- | :--- | :--- |
| **Fundo da Agenda** | `bg-background/95` (`#0A0A0C`) | Dark carvão profundo | Reduz fadiga visual em uso contínuo no salão |
| **Superfície de Cards** | `bg-card/80` (`#16161A`) | Vidro escuro texturizado | Separação nítida do grid temporal |
| **Cor Primária / Acento**| `text-primary`, `bg-primary` (`#F472B6`) | Rosa Choque Mary Esmalteria | Identidade da marca e destaque dos itens ativos |
| **Status Agendado** | `border-primary bg-primary/25` | Borda rosa, fundo translúcido | Alta visibilidade sem poluição |
| **Status Confirmado** | `border-emerald-400 bg-emerald-500/20` | Borda verde esmeralda, texto branco | Confirmação imediata para a recepcionista |
| **Status Concluído/Pago**| `border-purple-400 bg-purple-500/20` | Borda roxa, badge "Pago" | Registro financeiro concluído |
| **Bloqueio / Pausa** | `border-amber-400 bg-amber-500/20` | Borda âmbar, ícone de cadeado | Alerta operacional de indisponibilidade |
| **Linha Ao Vivo** | `bg-red-500` / pulso neon | Fita horizontal vermelha/rosa | Referência temporal imediata do momento atual |

---

## 7. MATRIZ DE RESPONSIVIDADE E BREAKPOINTS

### 7.1 Mobile Padrão (390px × 844px — iPhone 12/13/14/15)
- **Modo DIA (Agenda Pessoal)**:
  - Largura total: `390px`.
  - Coluna HORA fixa: `48px`.
  - Coluna do Profissional: `342px` (100% da área restante, sem scroll horizontal e sem margens fantasmas).
  - Cards: Layout completo com nome da cliente, serviço, valor e botões de ação touch-friendly.
- **Modo DIA (Agenda ADM)**:
  - 2 profissionais: `48px` (Hora) + `171px` (Prof 1) + `171px` (Prof 2) = `390px` exatos, sem scroll horizontal.
  - >2 profissionais: Scroll horizontal ativado com colunas de `150px` cada.
- **Modo SEMANA**:
  - `48px` (Hora fixa) + 7 colunas de `120px` cada em scroll horizontal contínuo.
- **Modo MÊS**:
  - Grade 7 colunas de `~48px` de largura por célula. Badges compactos com contagem numérica e bolinhas de status.

### 7.2 Mobile Grande (412px × 915px — Android / Pixel / Galaxy)
- **Modo DIA (Agenda Pessoal)**: Coluna do profissional ganha `364px` de largura.
- **Modo SEMANA**: Colunas de `130px` em scroll horizontal.
- **Modo MÊS**: Células com espaço para badge e indicador de faturamento resumido.

### 7.3 Tablet (768px × 1024px — iPad / Tablets de Balcão)
- **Modo DIA**: Até 4 profissionais visíveis simultaneamente sem scroll.
- **Modo SEMANA**: 7 colunas visíveis simultaneamente (`~95px` por coluna) sem necessidade de scroll horizontal.
- **Modo MÊS**: Células amplas (`~98px` de altura) exibindo contagem, bloqueios e primeiros nomes das clientes.

### 7.4 Desktop (1440px × 900px+ — Recepção / Gestão)
- **Modo DIA**: Visão panorâmica multi-profissional com cards detalhados.
- **Modo SEMANA**: Grade 7 dias ultra-espaçosa com drag-and-drop total entre dias e horários.
- **Modo MÊS**: Calendário executivo completo com cards de agendamentos expansíveis.

---

## 8. PLANO DE DIRETRIZES TÉCNICAS PARA O VP ENGINEERING

Para orientar a **Etapa 2 (Implementação Técnica)**, o VP Engineering deve seguir a seguinte estrutura de arquivos e responsabilidades:

1. **Refatoração do Componente `frontend/src/components/agenda/AgendaTimeline.jsx`**:
   - Integrar o estado de controle de visão: `viewMode` (`'dia' | 'semana' | 'mes'`).
   - Implementar o componente `ViewModeSelector` no topo da timeline.
   - Refatorar o cálculo de colunas no Modo DIA: quando `visibleProfessionals.length === 1`, utilizar layout `flex-1 w-full` em vez de `grid-cols-2`.
2. **Criação dos Sub-Modos ou Sub-Componentes**:
   - `AgendaWeekView.jsx` (ou módulo integrado na timeline): grade de 7 colunas para a semana selecionada com suporte a scroll horizontal mobile e sticky time axis.
   - `AgendaMonthView.jsx` (ou módulo integrado na timeline): grade 7x5 com cálculo de resumo por dia e handler de clique para alternar para o Modo DIA.
3. **Preservação das Regras de Negócio e Segurança**:
   - Manter a regra de privacidade de telefone (`hide_client_phone_from_collaborators` e `Telefone protegido 🔒`).
   - Manter handlers `onCancel`, `onComplete`, `onConfirm`, `onSelectAppt`, `onDropAppt` e `onQuickAdd`.
   - Manter o cálculo de durações múltiplas e bloqueios (`parseBlockNote`, `parseAppointmentDuration`).
4. **Suíte de Testes**:
   - Expandir `frontend/src/tests/agenda.test.js` cobrindo:
     - Cálculo de largura 100% para profissional único no Modo DIA.
     - Geração e mapeamento de intervalos para a visão de 7 dias (Modo SEMANA).
     - Geração de matriz de dias e agregação de dados para o calendário (Modo MÊS).
     - Comportamento de transição de modo de visualização.

---

## 9. PARECER EXECUTIVO FINAL

A especificação acima resolve integralmente a queixa de usabilidade da equipe de manicures, confere à recepção e à gestão uma visão preditiva completa (Semana e Mês) e preserva a solidez e aprovação da Agenda Administrativa diária.

**Autorização**: Aprovado pelo VP Strategy & Intelligence. Encaminhar para o VP Engineering para execução imediata da Etapa 2.
