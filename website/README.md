# Public website

This lightweight static product presentation is separate from the authenticated
[operations portal](../docs/USER_GUIDE.md). Its source is `index.html`,
`styles.css`, `site.js`, and genuine product assets in `assets/`.

## Build and preview

From the repository root:

```sh
python -m pip install -r website/requirements.txt
python scripts/build-public-site.py
python -m http.server 4173 --directory .local/public-site
```

Open `http://localhost:4173/fieldops3600/`. Serving the parent directory is
intentional: it tests the same `/fieldops3600/` base path as GitHub Pages.
There is no SPA fallback. Documentation routes are ordinary HTML files and work
on refresh.

The build renders all nonignored repository Markdown into HTML at its original
path with the `.html` extension. For example, `docs/README.md` becomes
`/fieldops3600/docs/README.html`. Source Markdown remains unchanged. Local images
and media referenced by documentation are copied; code and directory links open
their real repository source. Unresolved historical source references are
recorded in `.local/public-site/build-report.json`; missing rendered routes,
images, and fragments fail the build.

The output directory is fixed to `.local/public-site/fieldops3600` to keep cleanup
inside a dedicated generated directory. The builder only publishes explicit
website assets, rendered nonignored Markdown, and documentation-linked media.
It does not copy `.env`, `.git`, application bundles, dependencies, or generated
local configuration.

## Browser checks

```sh
npm ci --prefix website
npx --prefix website playwright install chromium
npm --prefix website run check
```

The browser checks serve the build locally and verify the landing page at
representative widths, its internal navigation, documentation paths, product
images, accessibility rules, and mobile-menu behavior. Evidence is written under
`artifacts/landing/`. See [QA results](../docs/landing/QA_RESULTS.md) for the actual
verification scope and limitations.

## GitHub Pages

[Public website workflow](../.github/workflows/public-site.yml) builds and checks
pull requests and source changes, then packages a Pages artifact. **Push and
pull-request runs never deploy.** To publish an approved revision, configure the
repository's Pages source as **GitHub Actions**, then manually run **Public
website** on `main` with **publish** selected. The deploy job requires Pages and
OIDC write permissions and uses the `github-pages` environment. No publishing
was performed during local implementation.

The artifact root contains the landing page, so GitHub Pages adds the repository
prefix once. Canonical, Open Graph, sitemap, and asset URLs use
`https://tousif-anwar.github.io/fieldops3600/`. There is no custom-domain assumption.

All actions are pinned to immutable commits. Pages action refs were checked
against the official `actions/upload-pages-artifact`, `actions/configure-pages`,
and `actions/deploy-pages` repositories on 2026-11-14. Existing repository action
pins were retained for checkout, language setup, and general artifact upload.

The static build is evidence of a valid artifact, not evidence of a successful
live deployment. The public site must be rechecked after an authorized publish.
