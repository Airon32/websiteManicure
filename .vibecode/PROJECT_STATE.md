# Project State - websiteManicure

## Última atualização: 10/08/2026

### Funcionalidade Recente
- **Agendamentos Fora do Expediente para Profissionais**:
  - Adicionada opção nos modais de agendamento (AdminDashboard) para permitir agendar horários fora do expediente programado (ex: 19:00 às 20:30).
  - Atualizada a `TimelineView` para expandir dinamicamente a grade horária e exibir agendamentos noturnos ou matutinos fora do expediente padrão.
  - Atualizada a validação no backend (`server.js`) para aceitar `ignoreExpedientLimit` / `allow_outside_hours` em chamadas efetuadas pela equipe.
  - Mantida a restrição normal de expediente para clientes no portal público.
  - Adicionados testes automatizados em `backend/schedule.test.js`.
  - Código compilado, testado e commitado na branch `main`.
