import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
  type User,
} from "oidc-client-ts";
import type { Role } from "./types";
import { useNavigate } from "react-router-dom";

export const manager = new UserManager({
  authority:
    import.meta.env.VITE_AUTHORITY ?? "http://localhost:8080/realms/fieldops",
  client_id: import.meta.env.VITE_CLIENT_ID ?? "fieldops-web",
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: "code",
  scope: "openid profile email",
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  // Only the short-lived PKCE transaction survives the redirect. Tokens remain in memory.
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  loadUserInfo: false,
});

const knownRoles: Role[] = [
  "Technician",
  "Dispatcher",
  "Supervisor",
  "OperationsManager",
  "Analyst",
  "Administrator",
];

export function rolesFromToken(accessToken?: string | null): Role[] {
  if (!accessToken) return [];
  // Keycloak realm roles are in the signed access token; API validates the signature.
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return [];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const token = JSON.parse(atob(padded));
    const realmRoles = Array.isArray(token.realm_access?.roles)
      ? token.realm_access.roles
      : [];
    return realmRoles.filter((role: unknown): role is Role =>
      knownRoles.includes(role as Role),
    );
  } catch {
    return [];
  }
}

export function rolesFromUser(user: User | null): Role[] {
  return rolesFromToken(user?.access_token);
}

interface Auth {
  user: User | null;
  ready: boolean;
  error: string | null;
  roles: Role[];
  login: () => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const loaded = (value: User) => {
      if (active) {
        setUser(value);
        setError(null);
      }
    };
    const unloaded = () => {
      if (active) setUser(null);
    };
    manager.events.addUserLoaded(loaded);
    manager.events.addUserUnloaded(unloaded);
    manager.events.addAccessTokenExpired(unloaded);
    const initialize = async () => {
      try {
        if (window.location.pathname === "/auth/callback") {
          const result = await manager.signinRedirectCallback();
          if (active) setUser(result);
          const returnTo =
            typeof result.state === "string" &&
            result.state.startsWith("/") &&
            !result.state.startsWith("//") &&
            !result.state.includes("\\")
              ? result.state
              : "/";
          navigate(returnTo, { replace: true });
        } else {
          const value = await manager.getUser();
          if (active && value && !value.expired) setUser(value);
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Authentication failed. Please try again.",
          );
      } finally {
        if (active) setReady(true);
      }
    };
    void initialize();
    return () => {
      active = false;
      manager.events.removeUserLoaded(loaded);
      manager.events.removeUserUnloaded(unloaded);
      manager.events.removeAccessTokenExpired(unloaded);
    };
  }, []);
  const roles = rolesFromUser(user);
  const login = async () => {
    setError(null);
    try {
      await manager.signinRedirect({
        state:
          window.location.pathname +
          window.location.search +
          window.location.hash,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Identity service is unavailable.",
      );
    }
  };
  const logout = async () => {
    setUser(null);
    await manager.signoutRedirect();
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        error,
        roles,
        login,
        logout,
        can: (...allowed) =>
          roles.includes("Administrator") ||
          allowed.some((r) => roles.includes(r)),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}
