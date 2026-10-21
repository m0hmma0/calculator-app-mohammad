import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import { hrefFor, parseRoute, type Route } from './routes';

interface RouterValue {
  route: Route;
  navigate: (route: Route, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/**
 * The History API with a subscription, which is all three routes ask for — and it
 * keeps the deep links that sharing depends on working on a cold load, because the
 * Worker already serves index.html for unknown paths.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback<RouterValue['navigate']>((route, options) => {
    const href = hrefFor(route);
    if (href === window.location.pathname) return;
    if (options?.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    setPathname(href);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ route: parseRoute(pathname), navigate }),
    [pathname, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

// The context belongs with the provider that owns it; splitting the hook into its
// own file to satisfy fast refresh would only move the same export elsewhere.
// eslint-disable-next-line react-refresh/only-export-components
export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside a RouterProvider');
  return value;
}

/**
 * A real anchor, so the link can be opened in a new tab, copied, or followed — but
 * handled in-page on a plain click.
 */
export function Link({
  to,
  children,
  className,
  ...rest
}: { to: Route; children: ReactNode; className?: string } & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useRouter();
  return (
    <a
      {...rest}
      className={className}
      href={hrefFor(to)}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
