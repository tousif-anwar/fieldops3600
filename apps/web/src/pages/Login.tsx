import { Button, Spinner } from "@fluentui/react-components";
import {
  ArrowRight,
  Check,
  Compass,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../auth";
import { InlineMessage } from "../components/common";

export function Login() {
  const auth = useAuth();
  return (
    <main className="login-page">
      <section className="login-story" aria-label="FieldOps 360 overview">
        <a className="brand login-brand" href="/">
          <span className="brand-symbol">
            <Compass size={26} aria-hidden="true" />
          </span>
          <span className="brand-copy">
            FieldOps <b>360</b>
            <small>Service operations</small>
          </span>
        </a>
        <div className="login-copy">
          <p className="login-kicker">Operations workspace</p>
          <h1>Field service, in one place.</h1>
          <p className="login-intro">
            Dispatch work, complete guided service, and understand what happened
            without leaving the operational record.
          </p>
          <ul className="login-points">
            <li>
              <Check size={17} aria-hidden="true" />
              Dispatch and scheduling
            </li>
            <li>
              <Check size={17} aria-hidden="true" />
              Guided field workflows
            </li>
            <li>
              <Check size={17} aria-hidden="true" />
              Audit-ready service history
            </li>
          </ul>
        </div>
        <div className="login-story-footer">
          <ShieldCheck size={16} aria-hidden="true" />
          Authorized users only · FieldOps 360
        </div>
      </section>
      <section className="login-form-side" aria-label="Sign in">
        <div className="login-box">
          <span className="login-lock">
            <LockKeyhole size={22} aria-hidden="true" />
          </span>
          <p className="login-kicker">Secure access</p>
          <h2>Welcome back.</h2>
          <p className="login-description">
            Sign in with your organization account to open your workspace.
          </p>
          {auth.error && <InlineMessage>{auth.error}</InlineMessage>}
          {auth.ready ? (
            <Button
              appearance="primary"
              size="large"
              className="login-button"
              onClick={() => void auth.login()}
              iconPosition="after"
              icon={<ArrowRight size={18} aria-hidden="true" />}
            >
              Continue to secure sign-in
            </Button>
          ) : (
            <Spinner size="small" label="Checking your session…" />
          )}
          <p className="login-identity-note">
            <LockKeyhole size={15} aria-hidden="true" />
            Keycloak single sign-on. Access follows your assigned role and team.
          </p>
          <p className="login-assistance">
            Need an account or help signing in? Contact your organization
            administrator.
          </p>
        </div>
        <div className="login-bottom">
          <span>FieldOps 360</span>
          <span>Secure by design</span>
        </div>
      </section>
    </main>
  );
}
