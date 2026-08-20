import Component, { lazy, Suspense, useEffect, useState } from 'react';
import React from 'react';
import { Analytics } from '@vercel/analytics/react';
import api from './api';
import { RouterProvider, useLocation, useNavigate } from './router';
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary capturou falha:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'Erro desconhecido';
      const isDateError =
        this.state.error?.name === 'RangeError' ||
        /Invalid Date|Invalid time value|RangeError/i.test(errorMessage);
      
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 pb-safe">
          <div className="bg-card border border-primary/30 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto text-2xl font-bold">
              ⚠️
            </div>
            <h2 className="text-xl font-serif font-black">
              {isDateError ? 'Erro de data detectado' : 'Ops! Falha ao carregar tela.'}
            </h2>
            <p className="text-xs text-muted">
              {isDateError 
                ? 'Ocorreu um erro ao processar datas. Isso pode acontecer com formatos de data incompatíveis. Clique abaixo para recarregar.'
                : 'Ocorreu um erro temporário no aplicativo. Clique abaixo para recarregar.'
              }
            </p>
            <details className="text-left text-[10px] text-muted/60 bg-background/50 rounded p-2 max-h-32 overflow-auto">
              <summary className="cursor-pointer font-bold mb-1">Detalhes técnicos</summary>
              <pre>{this.state.error?.stack || this.state.error?.message || 'Sem detalhes'}</pre>
            </details>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null, errorInfo: null });
                window.location.reload();
              }}
              className="w-full py-3 bg-primary text-white font-bold rounded-2xl hover:bg-primary-dark transition-all text-xs uppercase tracking-wider shadow-lg shadow-primary/20"
            >
              Recarregar Sistema
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const ClientDashboard = lazy(() => import('./pages/ClientDashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const ConfirmAppointment = lazy(() => import('./pages/ConfirmAppointment'));
const Login = lazy(() => import('./pages/Login'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const ReminderPreview = lazy(() => import('./pages/ReminderPreview'));

function PageLoader({ label = 'Carregando...' }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-live="polite">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted">{label}</p>
      </div>
    </div>
  );
}

function PrivateRoute({ children }) {
  const [status, setStatus] = useState('loading');
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    api.get('/api/session')
      .then(response => {
        if (active) setStatus(response.data.data?.type === 'staff' ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (active) setStatus('anonymous');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true });
  }, [status, navigate]);

  if (status === 'loading') {
    return <PageLoader label="Validando acesso seguro..." />;
  }

  return status === 'authenticated' ? children : <PageLoader label="Redirecionando..." />;
}

function LegalRoute() {
  const [config, setConfig] = useState({ businessName: 'Mary Esmalteria' });

  useEffect(() => {
    let active = true;
    api.get('/api/settings').then(response => {
      if (!active) return;
      const settings = response.data.data || [];
      const findValue = key => settings.find(item => item.key === key)?.value || '';
      let profile = {};
      try {
        profile = JSON.parse(findValue('public_profile') || '{}');
      } catch {
        profile = {};
      }
      setConfig({
        businessName: findValue('business_name') || 'Mary Esmalteria',
        whatsappNumber: findValue('whatsapp_number'),
        contactEmail: profile.privacyContact || '',
        address: profile.address || '',
        cancellationPolicy: profile.cancellationPolicy || ''
      });
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  return <LegalPage config={config} />;
}

function AppRoutes() {
  const location = useLocation();
  const isConfirmationRoute = /^\/confirmar\/[^/]+(?:\/[^/]+)?$/.test(location.pathname);

  let page;
  if (location.pathname === '/') page = <ClientPortal />;
  else if (location.pathname === '/login') page = <Login />;
  else if (location.pathname === '/meu-perfil') page = <ClientDashboard />;
  else if (['/privacidade', '/termos', '/politicas'].includes(location.pathname)) page = <LegalRoute />;
  else if (isConfirmationRoute) page = <ConfirmAppointment />;
  else if (import.meta.env.DEV && location.pathname === '/dev/reminders') page = <ReminderPreview />;
  else if (location.pathname === '/admin') page = <PrivateRoute><AdminDashboard /></PrivateRoute>;
  else page = <NotFound />;

  return (
    <div className={location.pathname === '/admin'
      ? 'min-h-0 min-w-0 max-w-full h-svh max-h-svh bg-background flex flex-col overflow-hidden'
      : 'min-h-screen min-w-0 max-w-full bg-background flex flex-col'
    }>
      <Suspense fallback={<PageLoader />}>{page}</Suspense>
    </div>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="text-center max-w-md">
        <p className="text-primary font-black tracking-widest text-sm mb-3">PÁGINA NÃO ENCONTRADA</p>
        <h1 className="text-4xl font-serif text-foreground mb-4">Vamos voltar para a agenda?</h1>
        <p className="text-muted mb-7">O endereço acessado não existe ou foi alterado.</p>
        <button type="button" className="btn-primary mx-auto" onClick={() => navigate('/', { replace: true })}>Ir para o início</button>
      </div>
    </main>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <RouterProvider>
        <AppRoutes />
      </RouterProvider>
      <Analytics />
    </ErrorBoundary>
  );
}

export default App;
