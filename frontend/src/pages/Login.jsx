import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useNavigate } from '../router';
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from 'lucide-react';
import IosInstallHint from '../components/IosInstallHint';

const STORAGE_FLAG = 'has_active_staff_session';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const restoreAttempted = useRef(false);

  useEffect(() => {
    const hasFlag = localStorage.getItem(STORAGE_FLAG) === 'true';
    if (!hasFlag || restoreAttempted.current) return;

    restoreAttempted.current = true;
    setRestoring(true);
    let active = true;
    
    api.get('/api/session')
      .then(response => {
        if (!active) return;
        if (response.data.data?.type === 'staff') {
          localStorage.setItem(STORAGE_FLAG, 'true');
          navigate('/admin', { replace: true });
        } else {
          localStorage.removeItem(STORAGE_FLAG);
          setRestoring(false);
        }
      })
      .catch((err) => {
        if (!active) return;
        // If session restore fails with 401 and needsRefresh, try refresh once
        if (err.response?.status === 401 && err.response?.data?.needsRefresh) {
          api.post('/api/auth/refresh')
            .then(refreshResponse => {
              if (!active) return;
              if (refreshResponse.data.data?.type === 'staff') {
                localStorage.setItem(STORAGE_FLAG, 'true');
                navigate('/admin', { replace: true });
              } else {
                localStorage.removeItem(STORAGE_FLAG);
                setRestoring(false);
              }
            })
            .catch(() => {
              if (active) {
                localStorage.removeItem(STORAGE_FLAG);
                setRestoring(false);
              }
            });
        } else {
          localStorage.removeItem(STORAGE_FLAG);
          setRestoring(false);
        }
      });
    return () => { active = false; };
  }, [navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown === 0) {
      setError('');
    }
  }, [countdown]);

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    if (loading || countdown > 0) return;
    setError('');
    setLoading(true);

    try {
      await api.post('/api/login', { username: username.trim(), password });
      localStorage.setItem(STORAGE_FLAG, 'true');
      navigate('/admin', { replace: true });
    } catch (err) {
      if (!err.response) {
        setError('Não foi possível conectar. Confira sua internet e tente novamente.');
      } else if (err.response.status === 429) {
        let retrySeconds = err.response.data?.retryAfterSeconds;
        if (!retrySeconds) {
          const retryHeader = err.response.headers?.['retry-after'];
          if (retryHeader) {
            retrySeconds = parseInt(retryHeader, 10);
          }
        }
        if (!retrySeconds || isNaN(retrySeconds)) {
          retrySeconds = 900;
        }
        setCountdown(retrySeconds);
      } else {
        setError(err.response.data?.error || 'Usuário ou senha incorretos.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (restoring) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[520px] h-[520px] bg-primary-light/45 dark:bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-25%] right-[-10%] w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />

        <section className="w-full max-w-md bg-card border border-border rounded-[2rem] md:rounded-[2.75rem] shadow-2xl overflow-hidden relative z-10 p-12 text-center">
          <div className="relative">
            <img 
              src="/assets/images/logo.png" 
              alt="Mary Esmalteria" 
              className="w-24 h-24 rounded-3xl object-contain bg-white/90 shadow-xl mx-auto mb-8 animate-pulse" 
              style={{ animation: 'pulse 2s ease-in-out infinite' }}
            />
            <style jsx>{`
              @keyframes pulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.05); opacity: 0.8; }
              }
            `}</style>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-primary mb-4">Restaurando sessão</p>
            <h2 className="text-2xl font-serif text-foreground mb-2">Aguarde um instante...</h2>
            <p className="text-muted">Estamos validando sua sessão automaticamente.</p>
            <Loader2 size={24} className="mx-auto mt-6 animate-spin text-primary" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[520px] h-[520px] bg-primary-light/45 dark:bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-25%] right-[-10%] w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />

      <section className="w-full max-w-4xl grid lg:grid-cols-[1.05fr_1fr] bg-card border border-border rounded-[2rem] md:rounded-[2.75rem] shadow-2xl overflow-hidden relative z-10">
        <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary via-primary-hover to-primary-dark text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,.22),transparent_45%)]" />
          <div className="relative">
            <img src="/assets/images/logo.png" alt="Mary Esmalteria" className="w-20 h-20 rounded-3xl object-contain bg-white/90 shadow-xl mb-10" />
            <p className="text-xs font-black uppercase tracking-[0.25em] text-white/70 mb-4">Área da equipe</p>
            <h1 className="text-4xl font-serif leading-tight mb-5">Sua agenda protegida e organizada.</h1>
            <p className="text-white/80 leading-relaxed max-w-sm">Acesse clientes, horários e resultados com uma sessão segura, exclusiva para profissionais autorizados.</p>
          </div>
          <div className="relative flex items-center gap-3 text-sm text-white/80">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>Sessão protegida e encerrada automaticamente.</span>
          </div>
        </div>

        <div className="p-7 sm:p-10 md:p-12">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors mb-9"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Voltar ao agendamento
          </button>

          <div className="mb-8">
            <div className="lg:hidden mb-5">
              <img src="/assets/images/logo.png" alt="Mary Esmalteria" className="w-16 h-16 rounded-2xl object-contain shadow-md" />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-primary mb-3">Acesso restrito</p>
            <h2 className="text-3xl font-serif text-foreground">Bem-vinda de volta</h2>
            <p className="text-muted mt-2">Entre com as credenciais fornecidas pela administração.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            {countdown > 0 ? (
              <div className="bg-red-500/10 text-red-600 dark:text-red-400 p-4 rounded-2xl border border-red-500/20 text-sm font-medium" role="alert" aria-live="assertive">
                Aguarde {formatCountdown(countdown)} para tentar novamente.
              </div>
            ) : error ? (
              <div className="bg-red-500/10 text-red-600 dark:text-red-400 p-4 rounded-2xl border border-red-500/20 text-sm" role="alert" aria-live="assertive">
                {error}
              </div>
            ) : null}

            <div>
              <label htmlFor="staff-username" className="block text-sm font-semibold text-foreground mb-2">Usuário</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} aria-hidden="true" />
                <input
                  id="staff-username"
                  type="text"
                  className="input-field pl-11"
                  placeholder="Seu nome de usuário"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  disabled={loading || countdown > 0}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label htmlFor="staff-password" className="block text-sm font-semibold text-foreground mb-2">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} aria-hidden="true" />
                <input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pl-11 pr-12"
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  disabled={loading || countdown > 0}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(value => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 min-h-11 min-w-11 p-2 text-muted hover:text-foreground rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary inline-flex items-center justify-center"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full min-h-12" disabled={loading || countdown > 0 || !username.trim() || !password}>
              {loading ? <><Loader2 size={18} className="animate-spin" /> Entrando com segurança...</> : 'Entrar no painel'}
            </button>
          </form>

          <p className="text-xs text-muted leading-relaxed mt-7 text-center">Por segurança, não compartilhe sua senha. Ao terminar, use "Encerrar sessão" no painel.</p>
          <IosInstallHint className="mt-5 lg:hidden" />
        </div>
      </section>
    </main>
  );
}