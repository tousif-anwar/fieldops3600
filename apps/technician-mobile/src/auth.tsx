import NetInfo from '@react-native-community/netinfo';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SessionLifecycle, StaleAuthenticationError, withDeadline } from './session-lifecycle';

WebBrowser.maybeCompleteAuthSession();

const authority = (process.env.EXPO_PUBLIC_AUTHORITY ?? 'http://localhost:8080/realms/fieldops').replace(/\/$/, '');
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
  if (Platform.OS === 'web') return; // Browser preview keeps tokens in memory.
  if (session) await SecureStore.setItemAsync(sessionKey, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  else await SecureStore.deleteItemAsync(sessionKey);
}

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Session | null>(null);
  const lifecycle = useRef(new SessionLifecycle());
  const discovery = useRef<AuthSession.DiscoveryDocument | null>(null);
  const discovering = useRef<Promise<AuthSession.DiscoveryDocument> | null>(null);
  const refreshing = useRef<{ generation: number; promise: Promise<string> } | null>(null);

  const getDiscovery = useCallback(async (): Promise<AuthSession.DiscoveryDocument> => {
    if (discovery.current) return discovery.current;
    if (!discovering.current) {
      const pending = (async () => {
        const document = await withDeadline(AuthSession.fetchDiscoveryAsync(authority));
        if (document.discoveryDocument?.issuer !== authority || !document.authorizationEndpoint
            || !document.tokenEndpoint || !document.userInfoEndpoint) {
          throw new Error('Identity provider configuration is incomplete or its issuer does not match.');
        }
        discovery.current = document;
        return document;
      })().finally(() => { if (discovering.current === pending) discovering.current = null; });
      discovering.current = pending;
    }
    return discovering.current;
  }, []);

  const updateSession = useCallback(async (value: Session, generation: number) => {
    await lifecycle.current.save(generation, () => saveSession(value), () => {
      current.current = value;
      setSession(value);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const generation = lifecycle.current.generation;
    const restore = async () => {
      try {
        const raw = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(sessionKey);
        if (raw && active && lifecycle.current.isCurrent(generation)) {
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
    const prepare = () => { void getDiscovery().catch(() => undefined); };
    prepare();
    const unsubscribe = NetInfo.addEventListener(state => { if (state.isConnected) prepare(); });
    const appState = AppState.addEventListener('change', state => { if (state === 'active') prepare(); });
    return () => { active = false; unsubscribe(); appState.remove(); };
  }, [getDiscovery]);

  const login = useCallback(async () => {
    const generation = lifecycle.current.advance();
    setError(null);
    setAuthenticating(true);
    try {
      const metadata = await getDiscovery();
      if (!lifecycle.current.isCurrent(generation)) throw new StaleAuthenticationError();
      // Every login attempt owns a fresh state and PKCE verifier.
      const request = new AuthSession.AuthRequest({ clientId, redirectUri,
        scopes: ['openid', 'profile'], responseType: AuthSession.ResponseType.Code,
        usePKCE: true, codeChallengeMethod: AuthSession.CodeChallengeMethod.S256 });
      const result = await request.promptAsync(metadata);
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
        throw new Error('Authentication was not completed. Try signing in again.');
      }
      const tokens = await withDeadline(AuthSession.exchangeCodeAsync({
        clientId, code: result.params.code, redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      }, metadata));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let profile: { sub?: string; name?: string; preferred_username?: string };
      try {
        const response = await fetch(metadata.userInfoEndpoint!, {
          headers: { Authorization: 'Bearer ' + tokens.accessToken }, signal: controller.signal,
        });
        if (!response.ok) throw new Error('Could not verify the signed-in identity.');
        profile = await response.json() as typeof profile;
      } finally { clearTimeout(timeout); }
      if (!profile.sub) throw new Error('Identity provider did not return a user identifier.');
      await updateSession({ subject: profile.sub,
        displayName: profile.name ?? profile.preferred_username ?? 'Technician',
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, idToken: tokens.idToken,
        expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000,
      }, generation);
    } catch (cause) {
      if (lifecycle.current.isCurrent(generation)) setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally { if (lifecycle.current.isCurrent(generation)) setAuthenticating(false); }
  }, [getDiscovery, updateSession]);

  const getAccessToken = useCallback(async (expectedSubject?: string): Promise<string> => {
    const active = current.current;
    const generation = lifecycle.current.generation;
    if (!active || (expectedSubject && expectedSubject !== active.subject)) {
      throw new Error('The signed-in user changed. Sign in to synchronize your own submissions.');
    }
    if (active.expiresAt > Date.now() + 30_000) return active.accessToken;
    if (!active.refreshToken) throw new Error('Session expired. Sign in again to synchronize.');
    if (!refreshing.current || refreshing.current.generation !== generation) {
      const pending = (async () => {
        const metadata = await getDiscovery();
        const result = await withDeadline(AuthSession.refreshAsync({ clientId, refreshToken: active.refreshToken }, metadata));
        if (!lifecycle.current.isCurrent(generation)) throw new StaleAuthenticationError();
        await updateSession({ ...active, accessToken: result.accessToken,
          refreshToken: result.refreshToken ?? active.refreshToken, idToken: result.idToken ?? active.idToken,
          expiresAt: Date.now() + (result.expiresIn ?? 300) * 1000 }, generation);
        return result.accessToken;
      })().finally(() => { if (refreshing.current?.promise === pending) refreshing.current = null; });
      refreshing.current = { generation, promise: pending };
    }
    return refreshing.current.promise;
  }, [getDiscovery, updateSession]);

  const logout = useCallback(async () => {
    const previous = current.current;
    const generation = lifecycle.current.advance();
    current.current = null;
    refreshing.current = null;
    setSession(null);
    setAuthenticating(false);
    setError(null);
    try { await lifecycle.current.clear(() => saveSession(null)); }
    catch {
      setError('Active session ended, but device credentials could not be erased. Unlock this device and retry sign-out before closing the app.');
      return;
    }
    const metadata = discovery.current;
    if (previous && metadata?.endSessionEndpoint) {
      const parameters = new URLSearchParams({ client_id: clientId, post_logout_redirect_uri: redirectUri });
      if (previous.idToken) parameters.set('id_token_hint', previous.idToken);
      try { await WebBrowser.openAuthSessionAsync(metadata.endSessionEndpoint + '?' + parameters, redirectUri); }
      catch { if (lifecycle.current.isCurrent(generation)) setError('Local session cleared. Identity-provider logout could not be confirmed while offline.'); }
    }
  }, []);

  return <AuthContext.Provider value={{ session, loading, authenticating, error, login, logout, getAccessToken }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required.');
  return value;
}
