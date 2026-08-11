import { useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  CalendarX2,
  ExternalLink,
  FileCheck2,
  LockKeyhole,
  Mail,
  MapPin,
  MessageCircle,
  Scale,
  ShieldCheck
} from 'lucide-react';
import { useNavigate } from '../router';
import { buildMapUrl } from '../utils/bookingExtras';

export const DEFAULT_LEGAL_CONFIG = Object.freeze({
  businessName: 'Mary Esmalteria',
  contactEmail: '',
  whatsappNumber: '',
  address: '',
  lastUpdated: '3 de agosto de 2026',
  cancellationWindowHours: null,
  lateToleranceMinutes: null,
  depositPolicy: '',
  cancellationPolicy: '',
  noShowPolicy: ''
});

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 15);
}

function safeEmail(value) {
  const email = String(value || '').trim().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function PolicySection({ id, icon: Icon, eyebrow, title, children }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-[2rem] border border-border/60 bg-card/70 p-6 shadow-sm backdrop-blur md:p-10">
      <div className="mb-7 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
          <Icon size={23} />
        </span>
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
          <h2 className="text-2xl text-foreground md:text-3xl">{title}</h2>
        </div>
      </div>
      <div className="space-y-6 text-sm leading-7 text-muted md:text-base">{children}</div>
    </section>
  );
}

function LegalList({ children }) {
  return <ul className="space-y-3 pl-1">{children}</ul>;
}

function LegalItem({ children }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[0.72rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export default function LegalPage({ config = DEFAULT_LEGAL_CONFIG }) {
  const navigate = useNavigate();
  const settings = useMemo(() => ({ ...DEFAULT_LEGAL_CONFIG, ...config }), [config]);
  const whatsapp = digitsOnly(settings.whatsappNumber);
  const email = safeEmail(settings.contactEmail);
  const mapUrl = buildMapUrl(settings.address);
  const cancellationWindow = Number(settings.cancellationWindowHours);
  const lateTolerance = Number(settings.lateToleranceMinutes);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `Privacidade e termos | ${settings.businessName}`;
    return () => { document.title = previousTitle; };
  }, [settings.businessName]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#conteudo-legal"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-xl transition-transform focus:translate-y-0"
      >
        Ir para o conteúdo
      </a>

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-muted transition-colors hover:bg-primary/5 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Voltar à agenda
          </button>
          <p className="hidden text-sm font-semibold text-foreground sm:block">{settings.businessName}</p>
        </div>
      </header>

      <main id="conteudo-legal" className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16">
        <section className="relative mb-10 overflow-hidden rounded-[2rem] border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-background p-7 md:p-12">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
          <div className="relative max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
              <ShieldCheck size={15} aria-hidden="true" />
              Transparência e cuidado
            </div>
            <h1 className="mb-5 text-4xl leading-tight text-foreground md:text-6xl">Seus dados e seu tempo merecem respeito.</h1>
            <p className="max-w-2xl text-base leading-8 text-muted md:text-lg">
              Aqui você encontra, em linguagem simples, como o {settings.businessName} trata seus dados e quais condições organizam os agendamentos.
            </p>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Última atualização: {settings.lastUpdated}</p>
          </div>
        </section>

        <nav aria-label="Nesta página" className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { href: '#privacidade', label: 'Privacidade', icon: LockKeyhole },
            { href: '#termos', label: 'Termos de uso', icon: Scale },
            { href: '#cancelamento', label: 'Cancelamentos', icon: CalendarX2 }
          ].map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card px-5 font-bold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <span className="flex items-center gap-3"><Icon size={19} aria-hidden="true" /> {label}</span>
              <span aria-hidden="true">↓</span>
            </a>
          ))}
        </nav>

        <div className="space-y-8">
          <PolicySection id="privacidade" icon={LockKeyhole} eyebrow="Política de privacidade" title="Como cuidamos dos seus dados">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Quais dados usamos</h3>
              <p>Para criar e administrar seu agendamento, podemos tratar nome, telefone/WhatsApp, serviço escolhido, profissional, data, horário e histórico de atendimentos. Informações técnicas de acesso também podem ser registradas para segurança e prevenção de fraude.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Para que usamos</h3>
              <LegalList>
                <LegalItem>Confirmar, lembrar, remarcar ou cancelar atendimentos solicitados por você.</LegalItem>
                <LegalItem>Manter sua área de cliente, responder dúvidas e prestar suporte.</LegalItem>
                <LegalItem>Proteger contas, detectar abuso e preservar a confiabilidade da agenda.</LegalItem>
                <LegalItem>Cumprir obrigações legais e melhorar o atendimento com dados agrupados, quando possível.</LegalItem>
              </LegalList>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Fundamentos e compartilhamento</h3>
              <p>O tratamento pode ocorrer para executar o serviço solicitado, cumprir obrigações legais, atender interesses legítimos de segurança ou, quando necessário, com seu consentimento. Dados podem ser processados por fornecedores essenciais de hospedagem, banco de dados e comunicação, sujeitos a medidas de proteção. Não comercializamos seus dados pessoais.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Prazo e seus direitos</h3>
              <p>Guardamos os dados pelo período necessário para prestar o serviço, proteger direitos e cumprir exigências legais. Você pode solicitar confirmação de tratamento, acesso, correção, informação sobre compartilhamento, portabilidade quando aplicável, oposição ou exclusão, respeitadas as hipóteses legais de conservação.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Cookies e preferências</h3>
              <p>Usamos recursos essenciais para manter sessões autenticadas com segurança. Preferências locais, como tema visual, podem ficar salvas no seu próprio dispositivo. Evitamos armazenar senhas ou dados sensíveis no navegador.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Segurança e menores de idade</h3>
              <p>Adotamos controles técnicos e organizacionais proporcionais ao serviço, embora nenhum sistema conectado à internet elimine totalmente os riscos. O agendamento de menores deve ser realizado ou autorizado por seu responsável legal.</p>
            </div>
          </PolicySection>

          <PolicySection id="termos" icon={FileCheck2} eyebrow="Termos de uso" title="Uma agenda clara para todos">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Confirmação do horário</h3>
              <p>O pedido só é considerado agendado após a confirmação exibida pelo sistema. Horários vistos durante a navegação podem ser reservados por outra pessoa antes da conclusão.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Informações corretas</h3>
              <p>Você é responsável por informar dados verdadeiros e atualizados. A área da cliente é pessoal; não compartilhe links de acesso, códigos ou informações que permitam consultar seus agendamentos.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Serviços, duração e valores</h3>
              <p>Descrição, duração estimada e valor são apresentados antes da confirmação. Mudanças solicitadas durante o atendimento podem alterar tempo e preço, mas devem ser informadas para sua concordância antes da execução.</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">Uso responsável</h3>
              <p>Não é permitido tentar acessar dados de terceiros, automatizar reservas abusivas, interferir no funcionamento do site ou usar a plataforma para fins ilícitos. Podemos limitar acessos que coloquem a agenda ou outras pessoas em risco.</p>
            </div>
          </PolicySection>

          <PolicySection id="cancelamento" icon={CalendarX2} eyebrow="Cancelamento e remarcação" title="Imprevistos acontecem">
            <p>Você pode solicitar cancelamento ou remarcação pela sua área de cliente ou por um canal oficial. A alteração só estará concluída quando aparecer confirmada no sistema ou for confirmada pela equipe.</p>
            <LegalList>
              {Number.isFinite(cancellationWindow) && cancellationWindow > 0 ? (
                <LegalItem>Para facilitar a reorganização da agenda, avise com pelo menos {cancellationWindow} horas de antecedência.</LegalItem>
              ) : (
                <LegalItem>A antecedência e as condições aplicáveis são informadas no momento da reserva ou pelos canais oficiais.</LegalItem>
              )}
              {Number.isFinite(lateTolerance) && lateTolerance >= 0 && (
                <LegalItem>A tolerância configurada para atrasos é de até {lateTolerance} minutos; depois disso, o atendimento pode precisar ser ajustado ou remarcado.</LegalItem>
              )}
              <LegalItem>Uma remarcação depende da disponibilidade atual e não preserva automaticamente o horário anterior.</LegalItem>
              <LegalItem>Agendamentos passados ou já concluídos não podem ser cancelados pelo site.</LegalItem>
            </LegalList>
            {settings.depositPolicy && (
              <div><h3 className="mb-2 text-lg font-semibold text-foreground">Sinal e pagamentos</h3><p>{settings.depositPolicy}</p></div>
            )}
            {settings.cancellationPolicy && (
              <div><h3 className="mb-2 text-lg font-semibold text-foreground">Condição de cancelamento</h3><p>{settings.cancellationPolicy}</p></div>
            )}
            {settings.noShowPolicy && (
              <div><h3 className="mb-2 text-lg font-semibold text-foreground">Não comparecimento</h3><p>{settings.noShowPolicy}</p></div>
            )}
          </PolicySection>

          <section className="rounded-[2rem] border border-primary/20 bg-primary/5 p-6 md:p-10" aria-labelledby="contato-privacidade">
            <div className="flex flex-col justify-between gap-7 md:flex-row md:items-center">
              <div className="max-w-2xl">
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-primary">Fale conosco</p>
                <h2 id="contato-privacidade" className="mb-3 text-2xl text-foreground md:text-3xl">Dúvidas ou solicitação sobre seus dados?</h2>
                <p className="leading-7 text-muted">Use um dos canais oficiais configurados abaixo. Se nenhum contato aparecer, solicite atendimento pelo canal informado durante seu agendamento.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
                {whatsapp && (
                  <a className="btn-primary whitespace-nowrap" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle size={17} aria-hidden="true" /> WhatsApp <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
                {email && (
                  <a className="btn-outline whitespace-nowrap normal-case tracking-normal" href={`mailto:${email}`}>
                    <Mail size={17} aria-hidden="true" /> {email}
                  </a>
                )}
                {mapUrl && (
                  <a className="btn-secondary whitespace-nowrap" href={mapUrl} target="_blank" rel="noopener noreferrer">
                    <MapPin size={17} aria-hidden="true" /> Ver localização <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-border/60 px-4 py-8 text-center text-xs leading-6 text-muted">
        <p>© {new Date().getFullYear()} {settings.businessName}. Esta página deve ser revisada sempre que o atendimento ou o uso de dados mudar.</p>
      </footer>
    </div>
  );
}
