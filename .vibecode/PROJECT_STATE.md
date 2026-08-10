# Project State - websiteManicure

## Última atualização: 10/08/2026

### Funcionalidades Recentes
- **Agendamentos Fora do Expediente**:
  - Opção no AdminDashboard e backend para marcar fora do expediente (ex: 19:00 às 20:30).
- **Agendamentos Sequenciais (Back-to-Back)**:
  - Liberados agendamentos no horário exato de término do atendimento anterior (ex: 07:00-08:00 seguido de 08:00-09:00; ou 12:00-13:20 seguido de 13:20-14:40).
  - Atualizada a função `buildTimeSlots` para incluir os horários exatos de término de atendimentos ativos como opções válidas no dropdown.
  - Testes unitários atualizados em `backend/schedule.test.js` e aprovados (7/7).
  - Alterações compiladas e commitadas na branch `main`.
