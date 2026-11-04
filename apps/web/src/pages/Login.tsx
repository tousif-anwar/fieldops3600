import { Button, Spinner } from "@fluentui/react-components";
import {
  ArrowRight,
  Check,
  Compass,
  History,
  LockKeyhole,
  Workflow,
} from "lucide-react";
import { useAuth } from "../auth";
import { InlineMessage } from "../components/common";

export function Login() {
  const auth = useAuth();
  return (
    <main className="login-page">
      <div className="login-story">
        <a className="brand login-brand" href="/">
          <span className="brand-symbol">
            <Compass size={28} />
          </span>
          <span>
            FieldOps <b>360</b>
            <small>SERVICE OPERATIONS</small>
          </span>
        </a>
        <div className="login-copy">
          <span className="login-kicker">
            <span /> A CLEARER VIEW OF FIELD SERVICE
          </span>
          <h1>
            Good service starts
            <br />
            with connected
            <br />
            <em>operations.</em>
          </h1>
          <p>
            Bring your people, workflows, and decisions together. From the first
            dispatch to the final detail.
          </p>
          <div className="login-points">
            <span>
              <Check size={17} />
              Confident dispatch
            </span>
            <span>
              <Check size={17} />
              Guided field work
            </span>
            <span>
              <Check size={17} />
              Complete visibility
            </span>
          </div>
          <div className="login-illustration" aria-hidden="true">
            <div className="illustration-route">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="illustration-card one">
              <Workflow size={22} />
              <div>
                <strong>One connected workflow</strong>
                <small>Every step moves service forward</small>
              </div>
              <span className="illustration-check">
                <Check size={16} />
              </span>
            </div>
            <div className="illustration-card two">
              <History size={21} />
              <div>
                <strong>The full operational story</strong>
                <small>Recorded. Traceable. Understandable.</small>
              </div>
            </div>
          </div>
        </div>
        <small className="login-copyright">
          FIELDOPS 360 · BUILT FOR THE PEOPLE IN THE FIELD
        </small>
      </div>
      <div className="login-form-side">
        <div className="login-box">
          <span className="login-lock">
            <LockKeyhole size={25} />
          </span>
          <span className="eyebrow">YOUR OPERATIONS WORKSPACE</span>
          <h2>Welcome back.</h2>
          <p>
            Sign in with your organization account to pick up where your team
            left off.
          </p>
          {auth.error && <InlineMessage>{auth.error}</InlineMessage>}
          {auth.ready ? (
            <Button
              appearance="primary"
              size="large"
              className="login-button"
              onClick={() => void auth.login()}
              iconPosition="after"
              icon={<ArrowRight size={18} />}
            >
              Continue to secure sign-in
            </Button>
          ) : (
            <Spinner size="small" label="Checking your session…" />
          )}
          <div className="identity-note">
            <ShieldIcon />
            <span>
              Protected with Keycloak single sign-on.
              <br />
              Your access follows your team and role.
            </span>
          </div>
          <div className="login-divider" />
          <p className="login-assistance">
            Need an account or help signing in?
            <br />
            Contact your organization administrator.
          </p>
        </div>
        <div className="login-bottom">
          <span>
            <LockKeyhole size={13} /> Secure by design
          </span>
          <span>FieldOps 360</span>
        </div>
      </div>
    </main>
  );
}
function ShieldIcon() {
  return <LockKeyhole size={16} />;
}
