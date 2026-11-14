import { Button, Spinner } from "@fluentui/react-components";
import { Compass } from "lucide-react";
import { useAuth } from "../auth";
import { InlineMessage } from "../components/common";

export function Login() {
  const auth = useAuth();
  return (
    <main className="login-page">
      <section className="login-form-side" aria-labelledby="sign-in-title">
        <div className="login-box">
          <a
            className="brand login-brand"
            href="/"
            aria-label="FieldOps 360 home"
          >
            <span className="brand-symbol">
              <Compass size={24} aria-hidden="true" />
            </span>
            <span className="brand-copy">
              FieldOps <b>360</b>
              <small>Service operations</small>
            </span>
          </a>
          <h1 id="sign-in-title">Sign in</h1>
          <p>Use your organization account.</p>
          {auth.error && <InlineMessage>{auth.error}</InlineMessage>}
          {auth.ready ? (
            <Button
              appearance="primary"
              size="large"
              className="login-button"
              onClick={() => void auth.login()}
            >
              Continue to secure sign-in
            </Button>
          ) : (
            <Spinner size="small" label="Checking your session�" />
          )}
          <p className="login-assistance">
            For account access, contact your administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
