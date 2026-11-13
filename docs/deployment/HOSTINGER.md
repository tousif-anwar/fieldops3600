# FieldOps 360 on Hostinger

Status: **preparation only; no Hostinger deployment or purchase has occurred**. Updated 2026-11-05 (America/New_York).

The deployment target changed from Oracle to Hostinger at the user's request. Oracle provisioning is no longer being pursued. Existing local Compose remains the development environment.

## Account check

The user selected “VPS — KVM plan.” The authenticated Hostinger account inspected in Chrome currently shows **Set up VPS** rather than an existing server. That button opens `/purchase-new-vps/start`, a new purchase flow. No purchase options were submitted. This does not establish whether a VPS exists in another account; clarification is pending.

The other Hostinger tab is a Node.js Git-repository import wizard. It has been left untouched. Importing the React application there would not deploy the complete .NET, PostgreSQL, RabbitMQ, Keycloak and Python stack.

## Required hosting product and sizing

Use a Hostinger **VPS with Docker**, with access to its Linux operating system. Shared web hosting, WordPress hosting, managed Node.js hosting and the product named Cloud Hosting do not supply the complete server environment required by this repository.

Hostinger currently documents KVM 2 as 2 vCPUs, 8 GB RAM and 100 GB storage, and KVM 4 as 4 vCPUs, 16 GB RAM and 200 GB storage. Plan details in the actual account take precedence. These are paid VPS subscriptions; existing web hosting or a domain subscription does not establish VPS entitlement.

The local 18-container stack used approximately **2.7 GiB at idle**, including monitoring, in one observed snapshot. An 8 GB VPS is a candidate for a small demonstration; 16 GB provides more headroom. Neither is a verified capacity guarantee. Startup, migration, build and realistic concurrent-use peaks still need measurement. Build images sequentially or before transfer to avoid concurrent compiler memory spikes. Hostinger also documents CPU-credit throttling, so sustained CPU performance needs testing on the selected server.

Do not purchase, upgrade or enable a paid add-on without the user's authorization of the actual terms and price.

## Deployment sequence

1. Open the existing VPS dashboard and inspect its exact plan, RAM, CPU, free storage, operating system, current applications, listening ports and backup status. Identify a hostname owned by the user, preferably a dedicated subdomain such as `fieldops.example.com`.
2. For a new, unused server, Hostinger offers Ubuntu 24.04 with Docker preinstalled. Preserve an existing server's operating system and applications while assessing compatibility; selecting a reinstall template is not an ordinary application deployment.
3. Point the dedicated hostname's DNS A record to the VPS IPv4 address. Review an existing AAAA record for that same hostname if IPv6 is not configured. Preserve unrelated website and email records.
4. Transfer the reviewed repository revision and production deployment configuration. Keep generated secrets outside version control and never enter private keys or passwords into chat. Docker Manager can manage Compose projects, but this repository also needs build contexts, migration assets and generated configuration; a generic Node.js importer cannot replace those steps.
5. Run one-shot database migrations with owner credentials. Run each long-lived service with its restricted application role. Keep PostgreSQL, RabbitMQ, intelligence, service HTTP ports and management interfaces private.
6. Publish only the HTTPS reverse proxy on ports 80/443. Restrict administrative SSH access. Use production Keycloak with the public HTTPS issuer; configure web PKCE redirect and logout URLs for the exact hostname. Preserve the SPA's `/auth/callback` route when choosing the Keycloak URL prefix.
7. Start all eight .NET services, gateway, web, PostgreSQL, RabbitMQ, Keycloak, warehouse worker and intelligence. Enable optional observability according to measured headroom. Verify readiness, authentication, resource authorization, workflow transitions, dispatch, notifications, analytics, Replay and exports.
8. Configure persistent volumes, bounded log retention, automatic restart and backups. Restore a backup into an isolated database and verify it before calling recovery tested. Check actual Hostinger backup entitlement and retention separately from application-level PostgreSQL backups.
9. Verify the application after a controlled reboot, then point the native Android production configuration at the public HTTPS endpoints. Test real login, API access and offline reconciliation. Confirm the service remains available with the Windows development stack offline.

A production Compose configuration is **not implemented**. It must be prepared and verified for the selected server, hostname, TLS and identity settings before deployment. **Do not deploy the local `docker-compose.yml` unchanged:** it uses development identity settings, localhost URLs and locally generated demo credentials.

## Inputs still needed

- An existing VPS dashboard, or a decision about a separately purchased VPS.
- Exact plan resources and confirmation of existing workloads.
- The intended domain or subdomain and its DNS authority.
- An authorized server-access method. Passwords, API tokens and private keys should not be pasted into chat.

## Official references

- [Hostinger VPS supported technologies and administrative access](https://www.hostinger.com/support/8852150-what-is-a-self-managed-vps-at-hostinger/)
- [Current plan resources and CPU-credit limits](https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/)
- [Ubuntu 24.04 Docker VPS template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/)
- [Hostinger Docker Manager](https://www.hostinger.com/support/12040789-hostinger-docker-manager-for-vps-simplify-your-container-deployments/)
- [Pointing a domain to a VPS](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/)

These describe provider capabilities, not evidence that FieldOps 360 has been deployed there.
