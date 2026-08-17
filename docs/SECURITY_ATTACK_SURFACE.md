# INVENTÁRIO DE SUPERFÍCIE DE ATAQUE & THREAT MODEL — MARY ESMALTERIA
**DOCUMENTO DE ENGENHARIA DE SEGURANÇA (SECURITY HARDENING)**  
**VERSÃO:** 2.0.0-PROD  
**DATA:** 16 de Agosto de 2026  
**CLASSIFICAÇÃO:** INTERNO / SECURITY AUDIT  

---

## 1. ESCOPO & ARQUITETURA DO SISTEMA

A aplicação **Mary Esmalteria** é uma plataforma web full-stack para agendamento, gestão de equipe, fluxo financeiro e atendimento de salão de beleza e esmalteria.

```
+-----------------------------------------------------------------------------------+
|                                 CLIENTE / BROWSER                                 |
|  - Portal Público & Catálogo      - Painel de Gestão (Admin / Manicures)          |
|  - Agendamento Online & Histórico - Confirmação via WhatsApp (1-Click HMAC Token) |
+------------------------------------------+----------------------------------------+
                                           |
                              HTTPS / WSS  |  (Cookies HttpOnly SameSite=Lax)
                                           v
+-----------------------------------------------------------------------------------+
|                        CAMADA DE SEGURANÇA & API BACKEND                          |
|  - Express.js com Security Headers (Helmet/Custom CSP, HSTS, X-Frame-Options)     |
|  - Middleware requireSameOrigin (Defesa Anti-CSRF)                                |
|  - Rate Limiting em Memória (Login Staff, OTP, Agendamentos, Confirmações)        |
|  - Gestão de Sessão: Assinatura HMAC-SHA256 com separação de domínio e TTL       |
|  - Autenticação de Clientes: WhatsApp OTP 6 dígitos com Hashing keyed no banco    |
|  - Máscara de Privacidade LGPD no Backend: 'Telefone protegido 🔒'               |
+------------------------------------------+----------------------------------------+
                                           |
                     Service Role Key      |  (TLS Seguro / Backend Only)
                                           v
+-----------------------------------------------------------------------------------+
|                            SUPABASE (POSTGRESQL & RLS)                            |
|  - Row Level Security (RLS) Ativo em 100% das Tabelas                             |
|  - Revogação Total de Privilégios Diretos para roles 'anon' e 'authenticated'      |
|  - Acesso restrito e exclusivo via backend através da role 'service_role'         |
|  - Trilha Imutável de Auditoria (tabela audit_logs)                               |
+-----------------------------------------------------------------------------------+
```

---

## 2. INVENTÁRIO DE ENDPOINTS & SUPERFÍCIE DE API

| Endpoint | Método | Autenticação | Rate Limit | Descrição de Ação & Superfície |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `GET` | Pública | Não | Health check básico (`{ status: 'live' }`) |
| `/api/login` | `POST` | Pública | 6 req / 15 min | Autenticação de equipe com senha (hash `scrypt`) |
| `/api/client/login` | `POST` | Pública / Legado | 15 req / 15 min | Login de cliente (bloqueado quando WhatsApp OTP ativo) |
| `/api/client-auth/request-code` | `POST` | Pública | 6 req / 15 min | Solicitação de OTP WhatsApp (tempo de resposta constante) |
| `/api/client-auth/verify-code` | `POST` | Pública | 12 req / 15 min | Validação atômica de código de 6 dígitos via stored procedure |
| `/api/session` | `GET` | Opcional | Não | Validação de sessão do cookie ativo e sanitização de perfil |
| `/api/logout` | `POST` | Pública | Não | Revogação e limpeza do cookie de sessão `mary_session` |
| `/api/services` | `GET` | Pública | Não | Listagem pública de catálogo de serviços ativos |
| `/api/services` | `POST` | `requireStaff('admin')` | Não | Criação de novos serviços |
| `/api/services/:id` | `PUT` | `requireStaff('admin')` | Não | Edição de serviços e sincronização de notas compostas |
| `/api/services/:id` | `DELETE` | `requireStaff('admin')` | Não | Exclusão de serviço |
| `/api/professionals` | `GET` | Pública | Não | Listagem de profissionais ativas (sem campos confidenciais) |
| `/api/professionals/:id` | `GET` | Pública | Não | Dados de perfil de profissional (sem senha/hash) |
| `/api/professionals` | `POST` | `requireStaff('admin')` | Não | Cadastro de nova profissional com senha `scrypt` |
| `/api/professionals/:id` | `PUT` | `requireStaff()` | Não | Edição de perfil (Admin ou a própria colaboradora - BOLA check) |
| `/api/professionals/:id` | `DELETE` | `requireStaff('admin')` | Não | Soft delete / desativação de profissional |
| `/api/clients/check/:phone` | `GET` | `requireStaff()` | Não | Checagem de cliente existente com máscara LGPD |
| `/api/clients` | `GET` | `requireStaff()` | Não | Lista de clientes com mascaramento de telefone LGPD |
| `/api/clients/:id` | `PUT` | `requireStaff()` | Não | Atualização de cliente (protege contra sobrescrita de placeholder) |
| `/api/clients/:id` | `DELETE` | `requireStaff('admin')` | Não | Exclusão de registro de cliente |
| `/api/clients` | `POST` | `requireStaff()` | Não | Criação rápida de cliente no balcão |
| `/api/clients/appointments` | `GET` | `requireClient` | Não | Histórico de agendamentos do cliente logado (isolado por telefone) |
| `/api/clients/my-history` | `GET` | `requireClient` | Não | Histórico detalhado do cliente logado (isolado por telefone) |
| `/api/clients/future-appointments`| `GET`| `requireClient`| Não | Próximos agendamentos do cliente logado |
| `/api/availability` | `GET` | Pública | 60 req / 1 min | Grade de ocupação e horários disponíveis |
| `/api/availability/next` | `GET` | Pública | 45 req / 1 min | Próximos horários vagos recomendados |
| `/api/appointments` | `GET` | `requireStaff()` | Não | Listagem de agendamentos (filtro por colaboradora ou geral) |
| `/api/appointments` | `POST` | Pública / Staff | 20 req / 60 min | Agendamento online ou presencial |
| `/api/appointments/block` | `POST` | `requireStaff()` | Não | Criação de bloqueio de horário na timeline |
| `/api/appointments/:id/reschedule`| `PUT`| `requireClient` | 20 req / 60 min | Remarcação online pelo cliente dentro das regras |
| `/api/appointments/:id` | `DELETE`| `requireStaff()` | Não | Cancelamento e liberação de horário |
| `/api/appointments/:id` | `PUT` | `requireStaff()` | Não | Alteração de horário, status ou profissional |
| `/api/appointments/:id/confirm-info`| `GET` | Token / Auth | 60 req / 15 min | Consulta de resumo de agendamento para confirmação |
| `/api/appointments/:id/confirm` | `POST` | Token / Auth | 20 req / 15 min | Confirmação de presença via token 1-click ou sessão |
| `/api/appointments/:id/cancel` | `POST` | Token / Auth | Não | Desmarcação de agendamento por token, cliente ou staff |
| `/api/appointments/:id/complete`| `POST`| `requireStaff()` | Não | Conclusão e baixa financeira do atendimento |
| `/api/financial/stats` | `GET` | `requireStaff('admin')` | Não | Métricas consolidadas de faturamento e comissões |
| `/api/notifications` | `GET` | `requireStaff()` | Não | Central de notificações operacionais |
| `/api/notifications/clear` | `POST` | `requireStaff('admin')` | Não | Limpeza de alertas lidos |
| `/api/settings` | `GET` | Pública / Staff | Não | Configurações públicas ou administrativas |
| `/api/settings/audit-logs` | `GET` | `requireStaff('admin')` | Não | Trilha de auditoria de alterações de privacidade e sistema |
| `/api/settings` | `PUT` | `requireStaff()` | Não | Alteração de configurações globais (Admin) ou locais (Staff) |

---

## 3. THREAT MODEL & MATRIZ DE PERFIS DE RISCO

### 3.1 Perfis de Ameaça (Actors)

```
[ 1. Atacante Anônimo Externo ] ---> Scan de portas, brute force de login/OTP, IDOR, injeção de payload, DoS.
[ 2. Cliente Não Confiável ]    ---> BOLA em agendamentos alheios, bypass de horário, spoofing de identidade.
[ 3. Colaboradora Maliciosa ]   ---> Exfiltração de base de telefones de clientes (LGPD), alteração de comissões/preços alheios.
[ 4. Admin Comprometido ]       ---> Alteração arbitrária de configurações sem trilha de auditoria.
[ 5. Terceiros / Infraestrutura]---> Vazamento de Service Key, man-in-the-middle, replay attacks de tokens.
```

### 3.2 Matriz de Ameaças & Severidades (STRIDE / DREAD)

| ID | Ameaça Identificada | Perfil | Severidade | Vetor de Ataque | Mitigação Implementada |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TH-01** | Brute Force de Credenciais Staff | Anônimo | **HIGH** | Múltiplas requisições em `/api/login` | Rate limit estrito (6 req/15min) + hashing `scrypt` com custo calibrado + timing safe equality |
| **TH-02** | Enumeração / Interceptação de OTP | Anônimo | **CRITICAL** | Adivinhação de códigos de 6 dígitos em `/api/client-auth/verify-code` | Rate limit (12 req/15min) + trava atômica em PostgreSQL via `consume_client_login_code` (máx 5 tentativas) + tempo de resposta equalizado |
| **TH-03** | BOLA / IDOR em Histórico de Clientes | Cliente | **HIGH** | Manipulação de query para ver agendamentos de outros clientes | Filtro mandatório no banco por telefone autenticado (`req.auth.phone`) + validação estrita server-side |
| **TH-04** | Exfiltração de Telefones das Clientes (LGPD) | Colaborador | **HIGH** | Raspagem da lista de clientes ou agenda para captação indevida | Máscara mandatória no backend (`'Telefone protegido 🔒'`), permissões granulares e trilha imutável em `audit_logs` |
| **TH-05** | BOLA na Edição de Perfil de Manicure | Colaborador | **MEDIUM** | Envio de `PUT /api/professionals/:id` com ID de colega | Verificação de role e ID: `req.auth.role === 'admin' || req.auth.id === id` |
| **TH-06** | Cross-Site Request Forgery (CSRF) | Anônimo | **HIGH** | Chamada forjada de origem maliciosa com cookies de sessão | Middleware `requireSameOrigin` validando `Sec-Fetch-Site`, `Origin` e `Referer` contra `APP_ORIGIN` e `ALLOWED_ORIGINS` |
| **TH-07** | Sobrescrita Acidental de Telefone em Edição | Colaborador | **MEDIUM** | Envio do placeholder mascarado em `PUT /api/clients/:id` | Backend detecta `isProtectedPhone` e ignora alteração de telefone se contiver máscara |
| **TH-08** | Injeção de Dados / Payload Excessivo | Anônimo | **MEDIUM** | Envio de JSONs gigantes para exaustão de memória | Body parser limitado a `32kb` + `safeText` truncando strings |
| **TH-09** | Falsificação de Tokens de Confirmação | Anônimo | **HIGH** | Geração arbitrária de links de confirmação de agendamento | Assinatura HMAC-SHA256 compacta `v2.<exp>.<sig>` com chave derivada de `SESSION_SECRET` |
| **TH-10** | Exposição de Stack Traces e Erros de BD | Anônimo | **LOW** | Forçar erros de SQL para mapear colunas do banco | Sanitização centralizada de erros retornando mensagens genéricas amigáveis |

---

## 4. POLÍTICAS DE DEFESA EM PROFUNDIDADE (DEFENSE-IN-DEPTH)

1. **Camada de Transporte & Headers**:
   - `Content-Security-Policy: default-src 'self' ...; frame-ancestors 'none';`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - `Referrer-Policy: strict-origin-when-cross-origin`
2. **Camada de Sessão**:
   - Cookies `mary_session` configurados como `HttpOnly; SameSite=Lax; Path=/; Secure (em prod)`.
   - Tokens HMAC assinados com separação de domínio `mary-esmalteria/session/v1`.
3. **Camada de Banco de Dados (Supabase PostgreSQL)**:
   - RLS ativo em 100% das tabelas.
   - Acesso restrito a `service_role` (backend).
4. **Camada de Auditoria**:
   - Tabela `audit_logs` registrando todas as mudanças de privacidade e permissões.
