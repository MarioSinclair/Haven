import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { setTokenGetter } from '../lib/api';
import { LANDED_KEY } from './Logo';
import { RibbonGate } from './RibbonGate';

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

export const authConfigured = !!(domain && clientId && audience);

/** The ribbon intro plays once per browser session, not on every visit. */
export const GATE_PASSED_KEY = 'gate-passed';

interface AuthInfo {
  logout: () => void;
}

const AuthContext = createContext<AuthInfo | null>(null);

/** A sign-out action, or null when Auth0 isn't configured (dev mode). */
export const useAuthInfo = () => useContext(AuthContext);

export function markGatePassed() {
  try {
    sessionStorage.setItem(GATE_PASSED_KEY, '1');
    sessionStorage.setItem(LANDED_KEY, '1');
  } catch {
    // Without storage the intro just plays again next time.
  }
}

function gatePassed(): boolean {
  try {
    return sessionStorage.getItem(GATE_PASSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Requires an Auth0 sign-in before rendering the app, through the ribbon gate. Without Auth0
 * settings (dev mode) the gate still plays once per session, then lets you in as the demo clinician.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!authConfigured) return <DevGate>{children}</DevGate>;
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

function DevGate({ children }: { children: ReactNode }) {
  const [passed, setPassed] = useState(gatePassed);
  if (passed) return <>{children}</>;
  return (
    <RibbonGate
      continueLabel="Enter the demo"
      note="Auth0 isn't configured on this build, so you'll enter as the demo clinician."
      onContinue={() => {
        markGatePassed();
        setPassed(true);
      }}
    />
  );
}

function SignedIn({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, getAccessTokenSilently, logout, error } = useAuth0();

  if (isLoading) return <div className="loading">Signing in…</div>;

  if (!isAuthenticated) {
    return (
      <>
        {error && <p className="notice gate-error">{error.message}</p>}
        <RibbonGate
          continueLabel="Sign in"
          note="Secure sign-in by Auth0. Patients see their own progress; physical therapists see their patients and set their limits."
          onContinue={() => {
            markGatePassed();
            void loginWithRedirect();
          }}
        />
      </>
    );
  }

  setTokenGetter(async () => (await getAccessTokenSilently()) ?? '');
  return (
    <AuthContext.Provider value={{ logout: () => logout({ logoutParams: { returnTo: window.location.origin } }) }}>
      {children}
    </AuthContext.Provider>
  );
}
