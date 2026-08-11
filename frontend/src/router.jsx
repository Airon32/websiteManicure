import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);

function readLocation() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state
  };
}

export function RouterProvider({ children }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const handlePopState = () => setLocation(readLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((destination, options = {}) => {
    if (typeof destination === 'number') {
      window.history.go(destination);
      return;
    }

    const target = new URL(destination, window.location.origin);
    if (target.origin !== window.location.origin) throw new Error('Navegação externa não permitida.');
    const nextUrl = `${target.pathname}${target.search}${target.hash}`;
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method](options.state ?? null, '', nextUrl);
    setLocation(readLocation());
    if (!options.preserveScroll) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error('RouterProvider não encontrado.');
  return context;
}

export function useLocation() {
  return useRouter().location;
}

export function useNavigate() {
  return useRouter().navigate;
}
