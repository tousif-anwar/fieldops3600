# Compiled business-service endpoint catalog

Generated 2026-11-05T16:52:35.520848+00:00 by [export-api-catalog.py](../../scripts/export-api-catalog.py). The eight locally built business-service images returned 80 route entries, including 56 business/SignalR entries. Git base: `a37f52ca4b639e06ca9f80c1ba97f77ec06623b4`; the working tree may contain newer uncommitted changes. Image IDs below identify the inspected binaries.

This inventory reads ASP.NET's actual `RouteEndpoint`, HTTP-method and authorization metadata. Each `docker compose run --rm --no-deps -T --pull never SERVICE --describe-endpoints` invocation exits before database initialization, broker consumers or an HTTP host start. It does not rebuild images, restart running services, apply migrations, or execute the business routes.

The list is a route and authorization inventory, not an OpenAPI schema or proof of successful calls. See [REFERENCE.md](REFERENCE.md) for DTOs, object-scope rules, gateway/intelligence routes and error semantics. See the feature completion matrix for executed end-to-end evidence.

## Reading the metadata

Policies joined by `+` all apply, including inherited route-group policies. Their role definitions are in [Bootstrap.cs](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs). Object/team/assigned-technician checks also run inside handlers and are not represented by route metadata alone. `ANY` means no HTTP-method restriction appears in the endpoint metadata; SignalR additionally negotiates its own transport protocol.

`No endpoint policy` means the service has no authorization requirement on that route; these are private deployment health/metrics surfaces. Compose does not publish the business-service ports. Public business requests go through the authenticated gateway; gateway paths are documented separately in REFERENCE.md.

## customers

Image: `fieldops360-customers:local`  
Inspected image ID: `sha256:477266c3e40c4aa6aadc9135655abdfa5224072ae698f46d57b4452908a518bd`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/customers/` | dispatch | Business |
| POST | `/api/customers/` | dispatch | Business |
| GET | `/api/customers/{id:guid}` | dispatch | Business |
| PUT | `/api/customers/{id:guid}` | dispatch | Business |
| GET | `/api/customers/{id:guid}/history` | dispatch | Business |
| GET | `/api/customers/{id:guid}/service-context` | operational | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## assets

Image: `fieldops360-assets:local`  
Inspected image ID: `sha256:9cabb4c2070aeba749bc9a30073b79337de153ff959d6984dcb8787f69512824`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/assets/` | dispatch | Business |
| POST | `/api/assets/` | dispatch | Business |
| GET | `/api/assets/{id:guid}` | dispatch | Business |
| PUT | `/api/assets/{id:guid}` | dispatch | Business |
| GET | `/api/assets/{id:guid}/history` | dispatch | Business |
| GET | `/api/assets/{id:guid}/reference` | operational | Business |
| GET | `/api/assets/{id:guid}/service-context` | operational | Business |
| GET | `/api/assets/by-work-order/{workOrderId:guid}` | operational | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## work-orders

Image: `fieldops360-work-orders:local`  
Inspected image ID: `sha256:1b8e7353a36bd5bab52dd180d199138b652ab4468b058559cb1a36371dc28299`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/work-orders/` | operational | Business |
| POST | `/api/work-orders/` | operational + dispatch | Business |
| GET | `/api/work-orders/{id:guid}` | operational | Business |
| PUT | `/api/work-orders/{id:guid}` | operational + dispatch | Business |
| PUT | `/api/work-orders/{id:guid}/asset` | operational + dispatch | Business |
| GET | `/api/work-orders/by-asset/{assetId:guid}` | operational | Business |
| GET | `/api/work-orders/by-customer/{customerId:guid}` | operational + dispatch | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## technicians

Image: `fieldops360-technicians:local`  
Inspected image ID: `sha256:30b78c1aec19a4f22ee4603e1f8ec862877e02a42f6d260b834d8c96199965fe`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/technicians/` | operational | Business |
| GET | `/api/technicians/{id}` | operational | Business |
| PUT | `/api/technicians/{id}` | operational + supervise | Business |
| GET | `/api/technicians/{id}/time-off` | operational | Business |
| POST | `/api/technicians/{id}/time-off` | operational + supervise | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## scheduling

Image: `fieldops360-scheduling:local`  
Inspected image ID: `sha256:9873241eeb0d56db40a2103220b953b59f9881f85299aeb6692bf9bf5df8a4e9`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/bookings/` | operational | Business |
| POST | `/api/bookings/` | operational + dispatch | Business |
| PUT | `/api/bookings/{id:guid}` | operational + dispatch | Business |
| POST | `/api/bookings/{id:guid}/cancel` | operational + dispatch | Business |
| POST | `/api/scheduling/recommendations` | dispatch | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## workflows

Image: `fieldops360-workflows:local`  
Inspected image ID: `sha256:7ab0642adcc25da634fe37df4e47d45e64373072a5f25d6592ee2feefe62445e`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/workflows/` | operational | Business |
| POST | `/api/workflows/` | operational + execute | Business |
| GET | `/api/workflows/{id:guid}` | operational | Business |
| POST | `/api/workflows/{id:guid}/assistance` | operational + execute | Business |
| POST | `/api/workflows/{id:guid}/interventions` | operational + supervise | Business |
| POST | `/api/workflows/{id:guid}/override` | operational + supervise | Business |
| POST | `/api/workflows/{id:guid}/pause` | operational + supervise | Business |
| POST | `/api/workflows/{id:guid}/resume` | operational + supervise | Business |
| POST | `/api/workflows/{id:guid}/submit` | operational + execute | Business |
| GET | `/api/workflows/templates/{version:int}` | operational | Business |
| GET | `/api/workflows/templates/default` | operational | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## notifications

Image: `fieldops360-notifications:local`  
Inspected image ID: `sha256:e541065af7cf35d88ca4c80194d44a146d7749e4e5d76180ac267ca2b85ead48`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/notifications` | operational | Business |
| POST | `/api/notifications/{id:guid}/acknowledge` | operational | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/hubs/notifications` | operational | SignalR transport |
| ANY | `/hubs/notifications/negotiate` | operational | SignalR transport |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## reporting

Image: `fieldops360-reporting:local`  
Inspected image ID: `sha256:3c41eda6c358517136f0248d04ed97f25e478e7ecebe67ee3c19f3a3f4aca5a6`

| Method | Exact route pattern | Endpoint policies | Surface |
|---|---|---|---|
| GET | `/api/replay/{workOrderId:guid}` | replay | Business |
| GET | `/api/replay/{workOrderId:guid}/export.csv` | replay | Business |
| GET | `/api/replay/{workOrderId:guid}/export.pdf` | replay | Business |
| GET | `/api/replay/{workOrderId:guid}/traces/{traceId}/availability` | replay | Business |
| POST | `/api/replay/projections/rebuild` | replay + admin | Business |
| GET | `/api/reports/assets` | report | Business |
| GET | `/api/reports/customers` | report | Business |
| GET | `/api/reports/export.csv` | report | Business |
| GET | `/api/reports/export.pdf` | report | Business |
| GET | `/api/reports/summary` | report | Business |
| GET | `/health/live` | No endpoint policy | Private health/metrics |
| ANY | `/health/ready` | No endpoint policy | Private health/metrics |
| ANY | `/metrics` | No endpoint policy | Private health/metrics |

## Reproduction and limits

Run `python scripts/export-api-catalog.py` from the initialized repository after building current service images. The ignored machine-readable evidence is `artifacts/api/endpoint-catalog.json`; it records compiled route metadata, immutable local image IDs and source SHA-256 digests without secrets.

The gateway, Keycloak and Python intelligence API are outside this eight-owner export. Gateway forwarding patterns and its authorization policies remain documented in REFERENCE.md. Request/response bodies, database constraints, integration events and handler-level object authorization require their linked source contracts and tests; this metadata does not substitute for those checks.
