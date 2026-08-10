# Project State - websiteManicure

## Última atualização: 10/08/2026

### Funcionalidades Recentes
- **Correção de Falso Conflito em Agendamentos Sequenciais**:
  - Resolvido o problema em que tentar agendar no minuto exato do término de um bloqueio/atendimento (ex: 12:00 logo após bloqueio 07:00-12:00) gerava a mensagem "Conflito de Agenda".
  - O motivo era a concatenação de strings no cálculo de horário de término. Adicionada conversão numérica estrita com `Number(...)`.
  - Agendamentos sequenciais (ex: 07:00-12:00 e 12:00-13:20) agora funcionam perfeitamente.
  - Testes unitários (8/8) e build do frontend validados.
  - Código commitado e enviado para `main`.
