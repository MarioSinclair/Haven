import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { createContext, useContext, type ReactNode } from 'react';
import { setTokenGetter } from '../lib/api';

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

export const authConfigured = !!(domain && clientId && audience);

interface AuthInfo {
  email: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthInfo | null>(null);

/** Signed-in user and a sign-out action, or null when Auth0 isn't configured (dev mode). */
export const useAuthInfo = () => useContext(AuthContext);

/** Requires an Auth0 sign-in before rendering the app. Without Auth0 settings it renders the app directly. */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!authConfigured) return <>{children}</>;
  return (
    <Auth0Provider
      domain={domain!}
      clientId={clientId!}
      authorizationParams={{ redirect_uri: window.location.origin, audience }}
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback
    >
      <SignedIn>{children}</SignedIn>
    </Auth0Provider>
  );
}

function SignedIn({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, getAccessTokenSilently, logout, user, error } = useAuth0();

  if (isLoading) return <div className="loading">Signing in…</div>;

  if (!isAuthenticated) {
    return (
      <div className="setup">
        <header className="setup-header">
          <div>
            <p className="eyebrow">Shoulder recovery</p>
            <h1>Sign in to continue</h1>
            <p className="muted">Patients see their own progress. Physical therapists see their patients and set their limits.</p>
          </div>
        </header>
        {error && <p className="notice">{error.message}</p>}
        <div className="inline">
          <button className="primary" onClick={() => loginWithRedirect()}>
            Sign in
          </button>
          <a className="button" href="/judges">
            For judges
          </a>
        </div>
      </div>
    );
  }

  setTokenGetter(async () => (await getAccessTokenSilently()) ?? '');
  return (
    <AuthContext.Provider value={{ email: user?.email ?? null, logout: () => logout({ logoutParams: { returnTo: window.location.origin } }) }}>
      {children}
    </AuthContext.Provider>
  );
}
