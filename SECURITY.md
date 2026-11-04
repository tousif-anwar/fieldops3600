# Security

Do not publish credentials or sensitive customer information in issues. This repository uses synthetic data only. Local credentials are generated into ignored files and must never be reused in production. Exposed local development endpoints bind to loopback; use TLS and a managed secret store for any non-local deployment.

Report vulnerabilities privately to the repository owner. Supply the affected revision, reproduction steps and impact. Access control belongs in every service, not just the UI. Replay exports are privileged, redact sensitive payloads and neutralize spreadsheet formulas. Production operation requires a security review and deployment-specific threat assessment; passing local checks is not production certification.
