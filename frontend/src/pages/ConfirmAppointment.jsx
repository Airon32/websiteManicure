import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Calendar } from 'lucide-react';
import api from '../api';

function ConfirmAppointment() {
  const { id } = useParams();
  const [status, setStatus] = useState('pending'); // 'pending', 'loading', 'success', 'error'

  const handleConfirm = async () => {
    setStatus('loading');
    try {
      await api.post(`/api/appointments/${id}/confirm`);
      setStatus('success');
    } catch (err) {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="glass-card max-w-md w-full p-8 text-center fade-in-up duration-500 border border-primary/20 shadow-2xl shadow-primary/10">
        
        {(status === 'pending' || status === 'loading') && (
          <div className="flex flex-col items-center">
            <div className={`w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6 ${status === 'loading' ? 'animate-pulse' : ''}`}>
              <Calendar size={40} className="text-primary" />
            </div>
            <h1 className="text-2xl font-serif text-foreground mb-2">Confirme seu Horário</h1>
            <p className="text-muted mb-8">Estamos aguardando sua confirmação para garantir sua vaga na nossa agenda.</p>
            <button 
              onClick={handleConfirm} 
              disabled={status === 'loading'}
              className="btn-primary w-full py-4 text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
            >
              {status === 'loading' ? 'Confirmando...' : 'Sim, Confirmo Minha Presença!'}
            </button>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center scale-in-center">
            <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mb-6">
              <CheckCircle size={40} className="text-green-500" />
            </div>
            <h1 className="text-2xl font-serif text-foreground mb-2">Presença Confirmada!</h1>
            <p className="text-muted">Muito obrigado! Seu horário está garantido. Esperamos você no salão.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center scale-in-center">
            <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h1 className="text-2xl font-serif text-foreground mb-2">Ops! Algo deu errado.</h1>
            <p className="text-muted mb-6">Não conseguimos confirmar automaticamente. O link pode ter expirado ou o agendamento já foi alterado.</p>
            <button onClick={() => setStatus('pending')} className="btn-secondary w-full py-3">
              Tentar Novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfirmAppointment;
