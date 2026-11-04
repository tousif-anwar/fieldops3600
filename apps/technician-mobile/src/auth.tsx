import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const authority = process.env.EXPO_PUBLIC_AUTHORITY ?? 'http://localhost:8080/realms/fieldops';
const clientId = process.env.EXPO_PUBLIC_CLIENT_ID ?? 'fieldops-mobile';
const redirectUri = AuthSession.makeRedirectUri({ scheme: 'fieldops360', path: 'oauth/callback' });
const sessionKey = 'fieldops.oidc.session.v1';

export interface Session {
  subject: string;
  displayName: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  authenticating: boolean;
  error: string | null;
  login(): Promise<void>;
  logout(): Promise<void>;
  getAccessToken(expectedSubject?: string): Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function saveSession(session: Session | null): Promise<void> {
  // Web preview retains tokens in memory only. Native tokens use platform storage.
  if (Platform.OS === 'web') return;
  if (session) await SecureStore.setItemAsync(sessionKey, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  else await SecureStore.deleteItemAsync(sessionKey);
}

export function AuthProvider({ children }: React.PropsWithChildren) {
  const discovery = AuthSession.useAutoDiscovery(authority);
  const [request, , promptAsync] = AuthSession.useAuthRequest({
    clientId, redirectUri, scopes: ['openid', 'profile'],
    responseType: AuthSession.ResponseType.Code, usePKCE: true,
  }, discovery);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Session | null>(null);
  const refreshing = useRef<Promise<string> | null>(null);

  const updateSession = useCallback(async (value: Session | null) => {
    await saveSession(value);
    current.current = value;
    setSession(value);
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const raw = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(sessionKey);
        if (raw && active) {
          const restored = JSON.parse(raw) as Session;
          if (restored.subject && restored.accessToken && Number.isFinite(restored.expiresAt)) {
            current.current = restored;
            setSession(restored);
          }
        }
      } catch { if (active) setError('Stored session could not be opened. Sign in again.'); }
      finally { if (active) setLoading(false); }
    };
    void restore();
    return () => { active = false; };
  }, []);

  const login = useCallback(async () => {
    setError(null);
    if (!request || !discovery?.tokenEndpoint || !discovery.userInfoEndpoint) {
      setError('Identity provider is unavailable. Check your connection and authority configuration.');
      return;
    }
    setAuthenticating(true);
    try {
      const result = await promptAsync();
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
        throw new Error('Authentication was not completed. Try signing in again.');
      }
      const tokens = await AuthSession.exchangeCodeAsync({
        clientId, code: result.params.code, redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      }, discovery);
      const response = await fetch(discovery.userInfoEndpoint, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) throw new Error('Could not verify the signed-in identity.');
      const profile = await response.json() as { sub?: string; name?: string; preferred_username?: string };
      if (!profile.sub) throw new Error('Identity provider did not return a user identifier.');
      await updateSession({
        subject: profile.sub, displayName: profile.name ?? profile.preferred_username ?? 'Technician',
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, idToken: tokens.idToken,
        expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000,
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
    finally { setAuthenticating(false); }
  }, [request, discovery, promptAsync, updateSession]);

  const getAccessToken = useCallback(async (expectedSubject?: string): Promise<string> => {
    const active = current.current;
    if (!active || (expectedSubject && expectedSubject !== active.subject)) {
      throw new Error('The signed-in user changed. Sign in to synchronize your own submissions.');
    }
    if (active.expiresAt > Date.now() + 30_000) return active.accessToken;
    if (!active.refreshToken || !discovery?.tokenEndpoint) throw new Error('Session expired. Sign in again to synchronize.');
    if (!refreshing.current) {
      refreshing.current = (async () => {
        const result = await AuthSession.refreshAsync({ clientId, refreshToken: active.refreshToken }, discovery);
        if (current.current?.subject !== active.subject) throw new Error('The signed-in user changed.');
        await updateSession({ ...active, accessToken: result.accessToken,
          refreshToken: result.refreshToken ?? active.refreshToken, idToken: result.idToken ?? active.idToken,
          expiresAt: Date.now() + (result.expiresIn ?? 300) * 1000 });
        return result.accessToken;
      })().finally(() => { refreshing.current = null; });
    }
    return refreshing.current;
  }, [discovery, updateSession]);

  const logout = useCallback(async () => {
    const previous = current.current;
    // Invalidate in-memory access before network calls; queued work stays owner-scoped.
    current.current = null;
    setSession(null);
    await saveSession(null);
    setError(null);
    if (previous && discovery?.endSessionEndpoint) {
      const parameters = new URLSearchParams({ client_id: clientId, post_logout_redirect_uri: redirectUri });
      if (previous.idToken) parameters.set('id_token_hint', previous.idToken);
      try { await WebBrowser.openAuthSessionAsync(`${discovery.endSessionEndpoint}?${parameters}`, redirectUri); }
      catch { setError('Local session cleared. Identity-provider logout could not be confirmed while offline.'); }
    }
  }, [discovery]);

  return <AuthContext.Provider value={{ session, loading, authenticating, error, login, logout, getAccessToken }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required.');
  return value;
}
