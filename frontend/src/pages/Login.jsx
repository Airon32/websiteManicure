import { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import { Lock, User } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/api/login', { username, password });
      const user = res.data.data;
      sessionStorage.setItem('user', JSON.stringify(user));
      navigate('/admin');
    } catch (err) {
      console.error('Login error:', err);
      setError('Credenciais incorretas.');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-primary-light/50 dark:bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="glass-card w-full max-w-md p-8 relative z-10 fade-in-up border-border">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-3xl mx-auto mb-4">A</div>
          <h2 className="text-2xl font-serif text-foreground">Acesso Restrito</h2>
          <p className="text-muted mt-2">Área para profissionais e gestão</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          {error && <div className="bg-red-500/10 text-red-500 p-3 rounded-lg border border-red-500/20 text-sm text-center">{error}</div>}
          
          <div className="relative">
            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted" size={18} />
            <input 
              type="text" 
              className="input-field pl-10" 
              placeholder="Usuário" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
          
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted" size={18} />
            <input 
              type="password" 
              className="input-field pl-10" 
              placeholder="Senha" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full shadow-lg shadow-primary/20">
            Entrar no Painel
          </button>
        </form>
        <div className="text-center mt-6">
          <button onClick={() => navigate('/')} className="text-sm text-muted hover:text-foreground transition-colors">Voltar para o site</button>
        </div>
      </div>
    </div>
  );
}
