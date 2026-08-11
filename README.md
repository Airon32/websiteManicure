# Mary Esmalteria — Agenda Web

Sistema de agendamento com portal público, área da cliente e painel para administração e profissionais. O frontend usa React/Vite, o backend usa Express e os dados ficam no Supabase. A publicação atual é compatível com Vercel Services.

## O que foi reforçado

- sessões assinadas em cookie `HttpOnly`, sem confiar em dados salvos pelo navegador;
- autorização no servidor para administradora, profissional e cliente;
- senhas com `scrypt`, incluindo migração automática das senhas legadas no primeiro login válido;
- bloqueio de consultas de agenda e dados pessoais por telefone sem sessão;
- disponibilidade pública sem nomes, telefones ou observações;
- limitação de tentativas, validação de origem, tamanho máximo de requisição e cabeçalhos de segurança;
- confirmação de presença com link assinado e prazo de validade;
- validação de conflitos para clientes, com tolerância de até 1 hora fora do expediente em remarcações;
- autonomia para profissionais criarem ou moverem compromissos com sobreposição e fora do expediente;
- dependências atualizadas e páginas carregadas sob demanda para melhorar a abertura do site.
- consulta de serviços, preços, profissionais e horários antes de solicitar dados da cliente;
- página pública com localização, funcionamento, pagamentos, portfólio, avaliações verificáveis, políticas e rodapé configuráveis pelo painel;
- login da cliente por código temporário no WhatsApp, com expiração, limite de tentativas e proteção contra enumeração;
- atalhos pós-agendamento para Google Agenda, arquivo `.ics`, mapa, cancelamento e remarcação.

## Preparação local

É necessário Node.js `20.19+` ou `22.12+`.

1. Copie `.env.example` para `.env` e preencha apenas com valores do seu projeto.
2. Instale as dependências em `frontend` e `backend`.
3. Na raiz, execute `npm run dev`.

O frontend abre em `http://localhost:5173` e o backend em `http://localhost:3001`.

## Variáveis da Vercel

Configure estas variáveis no serviço de backend:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` — chave secreta nova do Supabase; nunca use no frontend
- `SESSION_SECRET` — valor aleatório exclusivo com pelo menos 32 caracteres
- `OTP_SECRET` — outro valor aleatório com pelo menos 32 caracteres
- `APP_ORIGIN` — URL pública exata do site, sem barra final
- `BUSINESS_TIMEZONE=America/Sao_Paulo`

Para ativar o código de acesso pelo WhatsApp, configure também:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_OTP_TEMPLATE_NAME` — nome de um template de autenticação aprovado pela Meta
- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_OTP_TEMPLATE_LANGUAGE=pt_BR`
- opcionalmente `WHATSAPP_OTP_BUTTON_SUBTYPE`, quando o template aprovado utilizar botão de copiar código

Durante uma transição, `SUPABASE_KEY` ainda é aceita, mas a chave secreta atual (`SUPABASE_SECRET_KEY`) é a opção recomendada.

## Ajuste obrigatório no Supabase

Antes de publicar:

1. faça um backup do banco;
2. teste `supabase/security_hardening.sql` em um projeto de homologação;
3. confirme se não há usuários duplicados;
4. execute o arquivo no SQL Editor do projeto de produção;
5. valide login, novo agendamento, remarcação, cancelamento e confirmação.

A migração fecha o acesso direto das funções `anon` e `authenticated` às tabelas. O site passa a acessá-las exclusivamente pelo backend protegido. Se houver dados duplicados, a transação é cancelada sem aplicar mudanças parciais.

Em um banco que já recebeu uma versão anterior do reforço, execute também `supabase/allow_staff_overbooking.sql` uma vez. Esse ajuste remove somente o índice legado que impedia duas reservas no mesmo horário; as regras de conflito das clientes continuam sendo aplicadas pelo backend.

## Testes

- `npm test` dentro de `backend`
- `npm run lint` dentro de `frontend`
- `npm run build` dentro de `frontend`
- `npm audit` nos dois diretórios

## Acesso da cliente pelo WhatsApp

O backend já gera códigos aleatórios de seis dígitos, armazena apenas o hash, limita reenvios e tentativas e cria a sessão protegida depois da validação. Para o envio real funcionar, é obrigatório criar e aprovar um template de autenticação na Meta e configurar as variáveis acima na Vercel.

Quando a integração Meta não está configurada, o sistema informa isso claramente e permite o acesso legado por nome + WhatsApp apenas como contingência. Assim que a integração é ativada, o acesso legado é automaticamente recusado.

## Conteúdo público

No painel administrativo, abra **Configurações → Portal Público** para preencher endereço, link do mapa, Instagram, funcionamento, pagamentos, estacionamento, nota e quantidade de avaliações do Google, política de cancelamento e contato de privacidade. Nota e contagem de avaliações só aparecem ao público quando houver um link verificável para a fonte.
