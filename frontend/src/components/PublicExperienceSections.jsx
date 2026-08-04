/* eslint-disable react/prop-types */
import { useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  ExternalLink,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Scissors,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
} from 'lucide-react';
import {
  defaultBusinessDetails,
  defaultFaqs,
  defaultPolicies,
  galleryFallbacks,
} from '../data/publicExperienceDefaults';

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatPrice = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? moneyFormatter.format(parsed) : 'Sob consulta';
};

const formatDuration = value => {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Consulte a duração';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
};

function SectionHeading({ eyebrow, title, description, align = 'left', id }) {
  const alignment = align === 'center' ? 'mx-auto text-center' : '';
  return (
    <div className={`max-w-2xl ${alignment}`}>
      {eyebrow && (
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-primary">
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description && <p className="mt-4 text-sm leading-7 text-muted sm:text-base">{description}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon = Sparkles, title, description, actionLabel, onAction }) {
  return (
    <div className="col-span-full rounded-3xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
      <Icon className="mx-auto text-primary" size={28} aria-hidden="true" />
      <h3 className="mt-4 text-xl text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{description}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-outline mx-auto mt-6">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function SmartAction({ href, onClick, className, children, label, external = false, disabled = false }) {
  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={className}
        aria-label={label}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer noopener' : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className} aria-label={label} disabled={disabled}>
      {children}
    </button>
  );
}

export function ServicesShowcase({
  services = [],
  onBookService,
  onBookNow,
  maxItems = 6,
  eyebrow = 'Escolha com tranquilidade',
  description = 'Compare valor e tempo estimado antes de reservar. O preço final acompanha os serviços selecionados na agenda.',
}) {
  const visibleServices = services.slice(0, maxItems);
  return (
    <section id="servicos" className="scroll-mt-24 px-6 py-20 sm:py-24" aria-labelledby="services-title">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <SectionHeading
            id="services-title"
            eyebrow={eyebrow}
            title="Serviços claros, sem surpresa no final"
            description={description}
          />
          {onBookNow && (
            <button type="button" onClick={onBookNow} className="btn-outline shrink-0 self-start sm:self-auto">
              Ver agenda <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleServices.length ? visibleServices.map(service => (
            <article
              key={service.id ?? service.name}
              className="group flex h-full flex-col rounded-3xl border border-border bg-card/70 p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-2xl bg-primary/10 p-3 text-primary" aria-hidden="true">
                  <Scissors size={22} />
                </span>
                {service.category && (
                  <span className="rounded-full border border-border px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted">
                    {service.category}
                  </span>
                )}
              </div>
              <h3 className="mt-5 text-2xl text-foreground">{service.name}</h3>
              {service.description && <p className="mt-2 flex-1 text-sm leading-6 text-muted">{service.description}</p>}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border/70 pt-5">
                <strong className="text-lg text-foreground">{formatPrice(service.price)}</strong>
                <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                  <Clock3 size={15} aria-hidden="true" /> {formatDuration(service.duration)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => (onBookService ? onBookService(service) : onBookNow?.())}
                className="mt-5 inline-flex min-h-11 items-center justify-between rounded-xl bg-primary/10 px-4 text-sm font-bold text-primary transition hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Escolher este serviço <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
          )) : (
            <EmptyState
              icon={Scissors}
              title="Serviços disponíveis na agenda"
              description="Abra a agenda para conferir os serviços, valores e durações cadastrados pela equipe."
              actionLabel="Consultar agenda"
              onAction={onBookNow}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function QuickAvailability({ slots = [], onSelectSlot, onBookNow, loading = false }) {
  return (
    <section className="px-6 pb-20 sm:pb-24" aria-labelledby="availability-title">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-foreground px-6 py-8 text-background shadow-2xl sm:px-10 lg:flex lg:items-center lg:justify-between lg:gap-12">
        <div className="max-w-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary-light">Agenda rápida</p>
          <h2 id="availability-title" className="mt-3 text-3xl leading-tight sm:text-4xl">Encontre um horário sem perder tempo</h2>
          <p className="mt-3 text-sm leading-6 opacity-70">Os horários abaixo são sugestões recentes. A disponibilidade é confirmada ao finalizar a reserva.</p>
        </div>

        <div className="mt-7 flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2 lg:mt-0 lg:justify-end" aria-live="polite" aria-busy={loading}>
          {loading ? [1, 2, 3].map(item => (
            <div key={item} className="h-24 w-32 shrink-0 animate-pulse rounded-2xl bg-background/10" />
          )) : slots.length ? slots.slice(0, 5).map(slot => (
            <button
              key={slot.id ?? `${slot.dateLabel}-${slot.time}-${slot.professional ?? ''}`}
              type="button"
              onClick={() => onSelectSlot?.(slot)}
              className="min-h-24 w-32 shrink-0 rounded-2xl border border-background/15 bg-background/10 px-4 py-3 text-left transition hover:-translate-y-1 hover:border-primary hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
              aria-label={`Escolher ${slot.dateLabel ?? 'data disponível'} às ${slot.time}`}
            >
              <span className="block text-xs font-semibold uppercase tracking-wider opacity-70">{slot.dateLabel ?? 'Disponível'}</span>
              <strong className="mt-1 block text-2xl">{slot.time}</strong>
              {slot.professional && <span className="mt-1 block truncate text-xs opacity-70">{slot.professional}</span>}
            </button>
          )) : (
            <button type="button" onClick={onBookNow} className="btn-primary shrink-0 bg-primary px-6 shadow-none">
              Abrir calendário <CalendarDays size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function VisitInformation({ business = {}, whatsappHref, onWhatsApp, mapHref }) {
  const details = { ...defaultBusinessDetails, ...business };
  const addressText = details.address || 'Travessa Cachoeira das Flores, nº 41 - CEP 05574-410';
  const encodedAddress = encodeURIComponent(addressText);
  const googleMapsUrl = mapHref || `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  const wazeUrl = `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=-46.775%2C-23.585%2C-46.745%2C-23.565&layer=mapnik`;

  return (
    <section id="localizacao" className="scroll-mt-24 border-y border-border/70 bg-card/40 px-6 py-20 sm:py-24" aria-labelledby="visit-title">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <SectionHeading
              id="visit-title"
              eyebrow="Tudo antes de sair"
              title="Chegue tranquila e bem informada"
              description="Endereço, horários e localização reunidos em um só lugar. Se precisar de algo, fale diretamente com nossa equipe."
            />
            <div className="mt-7 flex flex-wrap gap-3">
              {(whatsappHref || onWhatsApp) && (
                <SmartAction href={whatsappHref} onClick={onWhatsApp} external={Boolean(whatsappHref)} className="btn-primary" label="Falar com a equipe pelo WhatsApp">
                  <MessageCircle size={17} aria-hidden="true" /> Falar no WhatsApp
                </SmartAction>
              )}
              <a href={googleMapsUrl} target="_blank" rel="noreferrer noopener" className="btn-outline">
                <Navigation size={17} aria-hidden="true" /> Abrir no Google Maps
              </a>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Card Onde Estamos com Mini-mapa Interativo */}
            <div className="sm:col-span-2 rounded-3xl border border-border bg-background p-6 shadow-sm overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5 text-xs font-black uppercase tracking-widest text-primary">
                    <MapPin size={18} aria-hidden="true" /> ONDE ESTAMOS
                  </span>
                  <span className="text-[11px] font-bold text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                    CEP 05574-410
                  </span>
                </div>
                <p className="mt-3 text-base font-semibold text-foreground">
                  {addressText}
                </p>
              </div>

              {/* Moldura do Mapa com Fallback Limpo e Atalhos de Navegação */}
              <div className="mt-5 overflow-hidden rounded-2xl border border-border/80 h-64 w-full relative group bg-muted/20">
                <iframe
                  title="Mapa de localização - Travessa Cachoeira das Flores, 41"
                  src={osmEmbedUrl}
                  className="w-full h-full border-0 filter contrast-[1.05] brightness-[0.95]"
                  loading="lazy"
                />
                
                {/* Overlay com botões de navegação rápida */}
                <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 bg-background/90 backdrop-blur-md p-3 rounded-xl border border-border/70 shadow-lg">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <MapPin size={15} className="text-primary" />
                    <span>Navegar para o local:</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs font-bold bg-primary text-white hover:bg-primary-dark px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                    >
                      <Navigation size={13} /> Google Maps
                    </a>
                    <a
                      href={wazeUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                    >
                      Waze
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Funcionamento */}
            <div className="sm:col-span-2 rounded-3xl border border-border bg-background p-6 shadow-sm">
              <span className="flex items-center gap-2.5 text-xs font-black uppercase tracking-widest text-primary">
                <Clock3 size={18} aria-hidden="true" /> FUNCIONAMENTO
              </span>
              <p className="mt-3 text-base font-medium text-foreground">
                {details.hours || 'Seg, Ter, Qua, Qui, Sex, Sáb - 08:00 às 20:00'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReviewsSection({ reviews = [], averageRating, reviewCount, sourceName, sourceHref, onReview }) {
  const hasRating = Boolean(sourceHref) && Number.isFinite(Number(averageRating)) && Number(reviewCount) > 0;
  const verifiedReviews = reviews.filter(review => review.sourceHref);
  return (
    <section id="avaliacoes" className="scroll-mt-24 px-6 py-20 sm:py-24" aria-labelledby="reviews-title">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr]">
          <div>
            <SectionHeading
              id="reviews-title"
              eyebrow="Confiança de verdade"
              title="Experiências que podem ser conferidas"
              description="Só mostramos nota, quantidade e selo de verificação quando existe uma fonte pública vinculada."
            />
            {hasRating && (
              <div className="mt-7 inline-flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4">
                <strong className="text-4xl text-foreground">{Number(averageRating).toFixed(1).replace('.', ',')}</strong>
                <div>
                  <div className="flex gap-0.5 text-amber-400" aria-label={`${averageRating} de 5 estrelas`}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star key={star} size={16} fill={star <= Math.round(Number(averageRating)) ? 'currentColor' : 'none'} aria-hidden="true" />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">{reviewCount} avaliações{sourceName ? ` em ${sourceName}` : ''}</p>
                </div>
              </div>
            )}
            {(sourceHref || onReview) && (
              <SmartAction href={sourceHref} onClick={onReview} external={Boolean(sourceHref)} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline" label="Ver avaliações na fonte original">
                Ver fonte original <ExternalLink size={15} aria-hidden="true" />
              </SmartAction>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {verifiedReviews.length ? verifiedReviews.slice(0, 4).map(review => (
              <figure key={review.id ?? `${review.author}-${review.text}`} className="flex h-full flex-col rounded-3xl border border-border bg-card/70 p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-0.5 text-amber-400" aria-label={`${review.rating ?? 5} de 5 estrelas`}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star key={star} size={14} fill={star <= Math.max(1, Math.min(5, Number(review.rating) || 5)) ? 'currentColor' : 'none'} aria-hidden="true" />
                    ))}
                  </div>
                  {review.sourceHref && (
                    <a href={review.sourceHref} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary" aria-label={`Conferir avaliação de ${review.author} na fonte`}>
                      <BadgeCheck size={15} aria-hidden="true" /> Conferir
                    </a>
                  )}
                </div>
                <blockquote className="mt-5 flex-1 text-sm leading-7 text-foreground">“{review.text}”</blockquote>
                <figcaption className="mt-5 border-t border-border/70 pt-4 text-sm font-bold text-foreground">
                  {review.author}
                  {review.date && <span className="ml-2 font-normal text-muted">· {review.date}</span>}
                </figcaption>
              </figure>
            )) : (
              <EmptyState
                icon={Star}
                title="Avaliações ainda não vinculadas"
                description="Quando houver uma fonte pública, os depoimentos poderão aparecer aqui com um link para conferência."
                actionLabel={sourceHref || onReview ? 'Ver avaliações' : undefined}
                onAction={onReview}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PortfolioSection({ items = [], services = [], onBookService, onBookNow }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const resolvedItems = galleryFallbacks.map((fallbackItem, index) => {
    const fallbackImage = typeof fallbackItem === 'string' ? fallbackItem : fallbackItem.image;
    const fallbackLabel = typeof fallbackItem === 'object' ? fallbackItem.label : undefined;
    const fallbackPrice = typeof fallbackItem === 'object' ? fallbackItem.price : undefined;
    const supplied = items[index] ?? {};
    const matchingService = services[index] ?? {};
    return {
      id: supplied.id ?? index,
      image: supplied.image || fallbackImage,
      label: supplied.label || fallbackLabel || matchingService.name || 'Inspiração da galeria',
      startingPrice: supplied.startingPrice ?? fallbackPrice ?? matchingService.price,
      service: supplied.service || matchingService,
      alt: supplied.alt || supplied.label || fallbackLabel || 'Trabalho de manicure Mary Esmalteria',
    };
  });

  return (
    <section id="portfolio" className="scroll-mt-24 bg-card/40 px-6 py-20 sm:py-24" aria-labelledby="portfolio-title">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="portfolio-title"
          eyebrow="Inspire sua próxima escolha"
          title="Nosso Portfólio de Trabalhos"
          description="Confira fotos reais de trabalhos recentes realizados em nosso espaço. Clique na imagem para ver em tamanho completo sem cortes."
          align="center"
        />
        
        {/* Gallery Grid com Imagens Inteiras */}
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {resolvedItems.map((item) => (
            <article key={item.id} className="group relative overflow-hidden rounded-3xl h-[420px] shadow-xl border border-border/60 bg-zinc-950 flex flex-col justify-between p-3">
              {/* Moldura que exibe a foto inteira sem cortar */}
              <div 
                className="w-full h-[310px] overflow-hidden rounded-2xl bg-zinc-900/80 flex items-center justify-center cursor-pointer relative"
                onClick={() => setSelectedPhoto(item)}
              >
                <img 
                  src={item.image} 
                  alt={item.alt} 
                  loading="lazy" 
                  className="max-h-full max-w-full object-contain transition duration-500 group-hover:scale-105" 
                />
                <span className="absolute top-2 right-2 text-[10px] font-bold text-white bg-black/60 backdrop-blur-md px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver foto inteira 🔍
                </span>
              </div>

              {/* Informações da foto */}
              <div className="pt-3 px-2 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-foreground line-clamp-1">{item.label}</h3>
                  <p className="text-xs font-semibold text-primary">
                    {Number.isFinite(Number(item.startingPrice)) ? `A partir de R$ ${Number(item.startingPrice).toFixed(2)}` : 'Valor sob consulta'}
                  </p>
                </div>
                {(onBookService || onBookNow) && (
                  <button
                    type="button"
                    onClick={() => (onBookService && item.service?.id ? onBookService(item.service) : onBookNow?.())}
                    className="rounded-full bg-primary text-white text-xs font-bold px-3 py-1.5 shadow transition-all hover:bg-primary-dark shrink-0 flex items-center gap-1"
                    aria-label={`Agendar ${item.label}`}
                  >
                    Agendar <ArrowRight size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Modal de Foto Completa Uncropped */}
      {selectedPhoto && (
        <div 
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-zinc-950 border border-border/80 rounded-3xl p-4 overflow-hidden flex flex-col items-center shadow-2xl">
            <button 
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 right-4 text-white bg-black/60 hover:bg-black/90 p-2 rounded-full transition-colors z-10 font-bold"
              aria-label="Fechar"
            >
              ✕
            </button>
            <img 
              src={selectedPhoto.image} 
              alt={selectedPhoto.alt} 
              className="max-h-[75vh] w-auto object-contain rounded-2xl" 
            />
            <div className="mt-4 text-center">
              <h4 className="text-lg font-serif text-white font-bold">{selectedPhoto.label}</h4>
              <p className="text-sm text-primary font-semibold mt-1">
                {Number.isFinite(Number(selectedPhoto.startingPrice)) ? `A partir de R$ ${Number(selectedPhoto.startingPrice).toFixed(2)}` : ''}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function ProfessionalsSection({ professionals = [], onSelectProfessional, onBookNow }) {
  return (
    <section id="profissionais" className="scroll-mt-24 px-6 py-20 sm:py-24 relative overflow-hidden" aria-labelledby="professionals-title">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="professionals-title"
          eyebrow="Escolha quem vai cuidar de você"
          title="Nossa Equipe de Especialistas"
          description="Conheça nossas profissionais qualificadas, veja especialidades e escolha a agenda ideal."
        />
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {professionals.length ? professionals.map((professional, index) => (
            <article 
              key={professional.id ?? professional.name} 
              className="group relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-border/80 bg-card/60 p-7 backdrop-blur-xl transition duration-500 hover:-translate-y-2 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/10"
            >
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-36 h-36 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition duration-500 pointer-events-none" />
              
              <div>
                <div className="relative mb-6">
                  <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-card border border-border/50 shadow-inner">
                    {professional.image ? (
                      <img src={professional.image} alt={`Retrato de ${professional.name}`} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center" aria-hidden="true">
                        <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/15 text-3xl font-serif font-bold text-primary shadow-md">
                          {professional.name?.charAt(0)?.toUpperCase() || <UserRound size={36} />}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="absolute bottom-3 right-3 rounded-full bg-background/80 backdrop-blur-md border border-border/60 px-3 py-1 text-[11px] font-bold text-emerald-500 shadow-sm flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Disponível
                  </span>
                </div>

                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">{professional.specialty || 'Profissional da equipe'}</p>
                <h3 className="mt-1.5 text-2xl font-serif text-foreground group-hover:text-primary transition-colors">{professional.name}</h3>
                
                <p className="mt-3 text-sm leading-6 text-muted">
                  {professional.bio || 'Consulte os serviços e horários disponíveis desta profissional na agenda.'}
                </p>

                {Array.isArray(professional.skills) && professional.skills.length > 0 && (
                  <ul className="mt-5 flex flex-wrap gap-2" aria-label={`Especialidades de ${professional.name}`}>
                    {professional.skills.map(skill => (
                      <li key={skill} className="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-semibold text-primary">{skill}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-8 pt-5 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => (onSelectProfessional ? onSelectProfessional(professional) : onBookNow?.())}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-5 text-xs font-black uppercase tracking-widest text-primary transition duration-300 group-hover:bg-primary group-hover:text-white group-hover:shadow-lg group-hover:shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Ver agenda de {professional.name?.split(' ')[0] || `Profissional ${index + 1}`} <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          )) : (
            <EmptyState
              icon={UserRound}
              title="Escolha a profissional na agenda"
              description="As profissionais disponíveis aparecem depois que você seleciona o serviço desejado."
              actionLabel="Conhecer disponibilidade"
              onAction={onBookNow}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function FaqAndPolicies({ faqs = defaultFaqs, policies = defaultPolicies, onWhatsApp, whatsappHref }) {
  return (
    <section id="politicas" className="scroll-mt-24 border-y border-border/70 bg-card/40 px-6 py-20 sm:py-24" aria-labelledby="faq-title">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading id="faq-title" eyebrow="Dúvidas rápidas" title="Antes de confirmar" description="Respostas diretas para você agendar com segurança e praticidade." />
          <div className="mt-8 space-y-3">
            {faqs.map(item => (
              <details key={item.question} className="group rounded-2xl border border-border bg-background p-5 open:border-primary/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {item.question}
                  <ChevronDown className="shrink-0 text-primary transition group-open:rotate-180" size={19} aria-hidden="true" />
                </summary>
                <p className="mt-4 pr-8 text-sm leading-7 text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary">Combinados importantes</p>
          <h2 className="mt-3 text-3xl leading-tight text-foreground sm:text-4xl">Políticas transparentes</h2>
          <div className="mt-8 space-y-4">
            {policies.map(policy => (
              <article key={policy.title} className="flex gap-4 rounded-2xl border border-border bg-background p-5">
                <span className="mt-0.5 text-primary" aria-hidden="true"><ShieldCheck size={22} /></span>
                <div>
                  <h3 className="text-lg text-foreground">{policy.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{policy.description}</p>
                </div>
              </article>
            ))}
          </div>
          {(onWhatsApp || whatsappHref) && (
            <SmartAction href={whatsappHref} onClick={onWhatsApp} external={Boolean(whatsappHref)} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline" label="Tirar uma dúvida pelo WhatsApp">
              Ainda ficou com dúvida? Fale com a equipe <MessageCircle size={16} aria-hidden="true" />
            </SmartAction>
          )}
        </div>
      </div>
    </section>
  );
}

export function PublicFooter({
  businessName = 'Esmalteria',
  tagline = 'Cuidado, beleza e praticidade em cada agendamento.',
  address,
  hours,
  phone,
  email,
  instagramHref,
  whatsappHref,
  mapHref,
  privacyHref = '#politicas',
  staffHref = '/admin',
  onBookNow,
  onWhatsApp,
  onStaffAccess,
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="w-full bg-background pt-16 pb-12 text-foreground border-t border-border/50 relative z-20" aria-label="Rodapé">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-10 border-b border-border/60 pb-12 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className="text-2xl font-serif text-foreground font-bold tracking-tight">{businessName}</h2>
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted">{tagline}</p>
            {onBookNow && (
              <button type="button" onClick={onBookNow} className="mt-6 btn-primary">
                Agendar agora <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>

          <nav aria-label="Navegação do rodapé">
            <h3 className="font-sans text-xs font-black uppercase tracking-widest text-primary">Explore</h3>
            <ul className="mt-5 space-y-3 text-sm text-muted">
              {[
                ['Serviços', '#servicos'],
                ['Portfólio', '#portfolio'],
                ['Profissionais', '#profissionais'],
                ['Avaliações', '#avaliacoes'],
                ['Localização', '#localizacao'],
              ].map(([label, href]) => (
                <li key={href}><a href={href} className="transition hover:text-primary">{label}</a></li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="font-sans text-xs font-black uppercase tracking-widest text-primary">Visite e fale</h3>
            <ul className="mt-5 space-y-3 text-sm text-muted">
              {address && <li className="flex gap-2.5 items-start"><MapPin className="mt-1 shrink-0 text-primary" size={16} aria-hidden="true" /><span className="leading-relaxed">{address}</span></li>}
              {hours && <li className="flex gap-2.5 items-start"><Clock3 className="mt-1 shrink-0 text-primary" size={16} aria-hidden="true" /><span className="leading-relaxed">{hours}</span></li>}
              {phone && <li className="flex gap-2.5 items-center"><Phone className="shrink-0 text-primary" size={16} aria-hidden="true" /><span>{phone}</span></li>}
              {email && <li className="flex gap-2.5 items-center"><Mail className="shrink-0 text-primary" size={16} aria-hidden="true" /><span>{email}</span></li>}
              {mapHref && <li className="pt-1"><a href={mapHref} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline"><Navigation size={15} aria-hidden="true" /> Abrir no mapa</a></li>}
            </ul>
          </div>

          <div>
            <h3 className="font-sans text-xs font-black uppercase tracking-widest text-primary">Acompanhe</h3>
            <div className="mt-5 flex gap-3">
              {instagramHref && <a href={instagramHref} target="_blank" rel="noreferrer noopener" className="rounded-full border border-border p-3 text-foreground transition hover:border-primary hover:bg-primary hover:text-white" aria-label="Abrir Instagram"><Instagram size={18} aria-hidden="true" /></a>}
              {(whatsappHref || onWhatsApp) && <SmartAction href={whatsappHref} onClick={onWhatsApp} external={Boolean(whatsappHref)} className="rounded-full border border-border p-3 text-foreground transition hover:border-primary hover:bg-primary hover:text-white" label="Abrir WhatsApp"><MessageCircle size={18} aria-hidden="true" /></SmartAction>}
            </div>
            <p className="mt-5 text-xs leading-5 text-muted">Atendimento de segunda a sábado das 08h às 20h.</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 pt-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {businessName}. Todos os direitos reservados.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 font-medium">
            <a href={privacyHref} className="hover:text-primary hover:underline">Privacidade e políticas</a>
            <SmartAction href={staffHref} onClick={onStaffAccess} className="hover:text-primary hover:underline" label="Acessar área da equipe">
              Área da equipe
            </SmartAction>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function PublicExperienceSections({
  profile = {},
  businessName = 'Esmalteria',
  whatsappNumber = '',
  services = [],
  quickSlots = [],
  quickSlotsLoading = false,
  business: businessOverrides = {},
  reviews = [],
  reviewSummary = {},
  portfolioItems = [],
  professionals = [],
  faqs = defaultFaqs,
  policies,
  links = {},
  footer = {},
  onBook,
  onSelectService,
  onBookNow,
  onBookService,
  onSelectQuickSlot,
  onSelectProfessional,
  onWhatsApp,
  onReview,
  onStaffAccess,
}) {
  const whatsappDigits = String(whatsappNumber).replace(/\D/g, '');
  const normalizedWhatsapp = whatsappDigits.length >= 10 && whatsappDigits.length <= 11
    ? `55${whatsappDigits}`
    : whatsappDigits;
  const resolvedWhatsappHref = links.whatsapp || (normalizedWhatsapp ? `https://wa.me/${normalizedWhatsapp}` : undefined);
  const resolvedOnBook = onBook || onBookNow;
  const resolvedOnSelectService = onSelectService || onBookService;
  const business = {
    name: businessName,
    address: profile.address,
    hours: profile.openingNote,
    payments: profile.payments,
    parking: profile.parking,
    phone: whatsappNumber || undefined,
    ...businessOverrides,
  };
  const resolvedLinks = {
    ...links,
    map: links.map || profile.mapsUrl,
    instagram: links.instagram || profile.instagramUrl,
    reviews: links.reviews || profile.googleReviewsUrl,
    whatsapp: resolvedWhatsappHref,
  };
  const resolvedReviewSummary = {
    averageRating: profile.googleRating,
    reviewCount: profile.googleReviewCount,
    sourceName: profile.googleReviewsUrl ? 'Google' : undefined,
    ...reviewSummary,
  };
  const resolvedPolicies = policies || defaultPolicies.map(policy => {
    if (policy.title === 'Cancelamento e reagendamento' && profile.cancellationPolicy) {
      return { ...policy, description: profile.cancellationPolicy };
    }
    if (policy.title === 'Privacidade' && profile.privacyContact) {
      return { ...policy, description: `Seus dados são usados para administrar seus agendamentos. Para dúvidas sobre privacidade: ${profile.privacyContact}.` };
    }
    return policy;
  });

  return (
    <div className="w-full">
      <ServicesShowcase
        services={services}
        onBookService={resolvedOnSelectService}
        onBookNow={resolvedOnBook}
        eyebrow={profile.heroEyebrow}
        description={profile.heroSubtitle}
      />
      <QuickAvailability slots={quickSlots} loading={quickSlotsLoading} onSelectSlot={onSelectQuickSlot} onBookNow={resolvedOnBook} />
      <VisitInformation business={business} whatsappHref={resolvedLinks.whatsapp} onWhatsApp={onWhatsApp} mapHref={resolvedLinks.map} />
      <ReviewsSection
        reviews={reviews}
        averageRating={resolvedReviewSummary.averageRating}
        reviewCount={resolvedReviewSummary.reviewCount}
        sourceName={resolvedReviewSummary.sourceName}
        sourceHref={resolvedLinks.reviews}
        onReview={onReview}
      />
      <PortfolioSection items={portfolioItems} services={services} onBookService={resolvedOnSelectService} onBookNow={resolvedOnBook} />
      <ProfessionalsSection professionals={professionals} onSelectProfessional={onSelectProfessional} onBookNow={resolvedOnBook} />
      <FaqAndPolicies faqs={faqs} policies={resolvedPolicies} onWhatsApp={onWhatsApp} whatsappHref={resolvedLinks.whatsapp} />
      <PublicFooter
        businessName={business.name}
        tagline={footer.tagline || profile.heroSubtitle}
        address={business.address}
        hours={business.hours}
        phone={business.phone}
        email={business.email}
        instagramHref={resolvedLinks.instagram}
        whatsappHref={resolvedLinks.whatsapp}
        mapHref={resolvedLinks.map}
        privacyHref={resolvedLinks.privacy}
        staffHref={resolvedLinks.staff}
        onBookNow={resolvedOnBook}
        onWhatsApp={onWhatsApp}
        onStaffAccess={onStaffAccess}
      />
    </div>
  );
}
