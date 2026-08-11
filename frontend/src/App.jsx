import { lazy, Suspense, useEffect, useState } from 'react';
import api from './api';
import { RouterProvider, useLocation, useNavigate } from './router';

const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const ClientDashboard = lazy(() => import('./pages/ClientDashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const ConfirmAppointment = lazy(() => import('./pages/ConfirmAppointment'));
const Login = lazy(() => import('./pages/Login'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

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
  const isConfirmationRoute = /^\/confirmar\/[^/]+$/.test(location.pathname);

  let page;
  if (location.pathname === '/') page = <ClientPortal />;
  else if (location.pathname === '/login') page = <Login />;
  else if (location.pathname === '/meu-perfil') page = <ClientDashboard />;
  else if (['/privacidade', '/termos', '/politicas'].includes(location.pathname)) page = <LegalRoute />;
  else if (isConfirmationRoute) page = <ConfirmAppointment />;
  else if (location.pathname === '/admin') page = <PrivateRoute><AdminDashboard /></PrivateRoute>;
  else page = <NotFound />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
  return <RouterProvider><AppRoutes /></RouterProvider>;
}

export default App;
