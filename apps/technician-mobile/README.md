# FieldOps 360 technician mobile

An Expo SDK 55 / React Native application for assigned jobs, today's appointments, eight guided service pages, dropdown forms, server SLA countdowns, assistance requests, notifications, offline drafts, and a durable synchronization queue. It uses the same gateway and resource-authorized backend APIs as the operations web app.

## Start a development build

```powershell
cd apps/technician-mobile
Copy-Item .env.example .env
npm ci
npm run check
npm run android
```

`npm run android` creates a local Android development build and requires the Android SDK, Java, and an emulator or connected device. `npm run ios` requires macOS/Xcode. Once the native development build is installed, `npm start` runs Metro with `--dev-client`. Expo Go is not the supported OAuth environment because the app uses its own native callback scheme.

The registered public Keycloak client is `fieldops-mobile`. It must require Authorization Code Flow with PKCE/S256 and permit `fieldops360://oauth/callback`. The app opens the system browser; it never collects a password. Native access/refresh tokens are stored in Expo SecureStore with device-only, unlocked Keychain accessibility. Web preview tokens remain in memory only. Tokens are refreshed with a single-flight refresh operation, and the requesting user is checked before queued work can obtain a token. Logout clears local tokens immediately and attempts the provider end-session endpoint.

For an Android emulator using host-local services, reverse the host ports before opening the app:

```powershell
adb reverse tcp:5100 tcp:5100
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8081 tcp:8081
```

Then the example localhost URLs preserve the same Keycloak issuer as the Compose environment. Physical devices require reachable hostnames and the same issuer URL in Keycloak, gateway, backend, and mobile configuration. Do not mix `localhost`, emulator aliases, and LAN hostnames in OIDC issuer settings.

`FIELDOPS_ALLOW_HTTP=true` enables cleartext traffic through Expo's native build-properties plugin for local development. Its default is false. Release configurations must use HTTPS and leave this flag unset. A changed native setting requires rebuilding the development app.

## User flow

1. Sign in with an authorized technician account.
2. Open an assigned job from **My jobs** or **Schedule**.
3. Start its workflow when online, then open the current stage.
4. Select accurate predefined options. Conditional fields appear only when relevant.
5. Choose **Save draft**, **Submit & continue**, or **Request assistance**.
6. Completed and supervisor-overridden stages are read-only history.
7. Review **Alerts** and acknowledge notifications while connected.
8. Review **Sync** if a queued submission needs attention.

The countdown is a local estimate from persisted server timestamps. It is never an SLA clock of record. Approved server pauses freeze the displayed remaining time. Saving a draft, requesting assistance, losing connectivity, or closing the app does not pause the authoritative deadline. Predefined answers that do not fit have an assistance/exception path; the app does not require an inaccurate selection.

The current workflow and notifications poll their authenticated services every 15 seconds while their screens are active and online. SLA status updates preserve unsaved form selections. Native background push delivery is not implemented. System warnings and breach events continue on the backend while the app is closed.

## Offline synchronization

Successful job/workflow/template queries are cached using TanStack Query's AsyncStorage persister. Draft and queue keys include the authenticated subject, workflow, and stage. Query clients and storage namespaces are recreated when accounts change. Tokens are never written into AsyncStorage.

Drafts include the template and workflow version. A stale draft is flagged for review instead of being silently applied. Each queued submission records a cryptographic UUID idempotency key, the expected server version, the original client-reported action time, whether it was created offline, answers, attempt count, status, and next retry time. Server receipt time is displayed separately when returned in the HTTP Date header. The client timestamp is evidence, never authority.

The queue serializes mutations and network flushing. It persists before sending and after each receipt. A process interrupted while `sending` retries the same logical key. Transient/401/408/429/5xx failures back off exponentially up to 60 seconds. A 409 becomes a durable conflict; a 400/403/404 becomes a failed action requiring review. It never rebases the version or changes a stage index automatically.

Only the current stage can be queued. The next stage opens after server acceptance, preserving the authoritative stage ordering while disconnected. On conflict, inspect the queued answers, discard the local action, refresh the job, and re-enter the correct current-stage response. The server retains its audit history.

The cache and drafts use AsyncStorage rather than application-level database encryption. This is suitable for the included synthetic data and assumes an OS-protected device. Real deployments handling sensitive addresses/customer data require a managed device policy, encrypted local storage, cache retention/remote wipe controls, and an explicit logout retention policy. Owner namespaces prevent ordinary cross-account UI access; they are not encryption against a compromised device.

## Verification

```powershell
npm run check
npx expo install --check
$env:CI='1'
npx expo export --platform android --output-dir dist/android
```

The implementation was typechecked, all 12 offline/form tests passed, and an Android Hermes bundle was exported successfully through Metro. Expo's local SDK dependency compatibility check passed. Tests cover persistence/restart, stable idempotency, retry timing, concurrent flushes, remount races, conflicts, account isolation, terminal authorization failures, conditional fields, and hidden-answer removal.

The native Android/iOS app has not been installed on an emulator or physical device in this session. Native OAuth browser return, SecureStore behavior on real devices, touch/VoiceOver/TalkBack interactions, and airplane-mode recovery require device validation before claiming a complete mobile release. There is no claim of a signed store artifact or real-device end-to-end pass.

Primary references: [Expo authentication](https://docs.expo.dev/guides/authentication/), [AuthSession](https://docs.expo.dev/versions/v55.0.0/sdk/auth-session/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), and [development builds](https://docs.expo.dev/develop/development-builds/introduction/).
