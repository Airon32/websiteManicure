import { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';
import { isIosDevice, isStandaloneDisplay } from '../utils/iosDisplay';

const STORAGE_KEY = 'mary_ios_install_hint_dismissed';

export default function IosInstallHint({ className = '' }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') return;
    } catch {
      return;
    }
    const nav = typeof navigator === 'undefined' ? null : navigator;
    const win = typeof window === 'undefined' ? null : window;
    if (!isIosDevice(nav?.userAgent || '', nav) || isStandaloneDisplay(win)) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className={`rounded-xl border border-primary/30 bg-card/95 px-3 py-2.5 shadow-lg ${className}`} role="note">
      <div className="flex items-start gap-2">
        <Share size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
          Para usar como app no iPhone: toque em <strong className="text-foreground">Compartilhar</strong> e depois em <strong className="text-foreground">Adicionar à Tela de Início</strong>.
        </p>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-foreground"
          aria-label="Dispensar dica de instalação"
          onClick={() => {
            try {
              sessionStorage.setItem(STORAGE_KEY, '1');
            } catch {
              /* ignore quota */
            }
            setVisible(false);
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
