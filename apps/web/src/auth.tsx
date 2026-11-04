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

export function rolesFromUser(user: User | null): Role[] {
  if (!user) return [];
  // Keycloak realm roles are in the signed access token; API validates the signature.
  try {
    const token = JSON.parse(
      atob(
        user.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
      ),
    );
    return (token.realm_access?.roles ?? []) as Role[];
  } catch {
    return [];
  }
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
        state: window.location.pathname + window.location.search,
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
