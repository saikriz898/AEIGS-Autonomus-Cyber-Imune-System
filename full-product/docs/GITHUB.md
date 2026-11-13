# GitHub setup and delivery

## Repository and daily development

The project remote is [saikriz898/AEIGS-Autonomus-Cyber-Imune-System](https://github.com/saikriz898/AEIGS-Autonomus-Cyber-Imune-System). To start a new checkout:

```powershell
git clone https://github.com/saikriz898/AEIGS-Autonomus-Cyber-Imune-System.git
Set-Location AEIGS-Autonomus-Cyber-Imune-System
git switch -c your-change
# Make and verify your changes.
git add .
git status --short
git diff --cached --stat
# Inspect the staged file list before committing.
git commit -m "Describe your change"
git push -u origin your-change
```

Exclude raw datasets, `.env`, `.e2e`, database backups, uploads, and model weights. Ignore rules do not remove files already tracked. Inspect existing history separately when importing another repository.

Open a pull request into `main`. Review execution evidence on the repository's Actions page; successful publication of source is separate from a passing workflow or deployed service.

## Repository settings

Enable Actions and allow the referenced actions. After their first successful run, require these checks on the default branch: `Backend tests and lint`, `Frontend typecheck and build`, `Prototype tests, build and browser checks`, and `Container build and readiness`. Enable PR review, protect release tags, configure private vulnerability reporting, and select a security contact. Add CODEOWNERS when actual users/teams are known.

Only the publishing job requests `packages: write`; other jobs have read-only repository permissions. Organization policy must allow GHCR publishing. The workflow uses `GITHUB_TOKEN`, not a long-lived registry password. Review package visibility/access separately from repository visibility.

## CI behavior

CI runs on PRs, main/master pushes, manual dispatch, and reusable calls. It uses Node 22, Python 3.12, npm lockfiles, and backend pinned constraints. Container checks generate fresh random configuration in an ephemeral runner, start PostgreSQL/Redis/API/worker/frontend, check readiness and the frontend API proxy, inspect migration state, then remove only the disposable CI stack.

No production secrets, private datasets, or live AI calls are required. Failed prototype browser checks produce a diagnostic artifact retained for seven days. Product browser tests still need a local isolated stack and real datasets; see OPERATIONS.md. Container readiness does not replace them.

## Release images

After review, push a version tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

The delivery workflow runs all CI jobs on the same revision before publishing:

- `ghcr.io/<owner>/<repo>-backend:sha-<full-commit-sha>`
- `ghcr.io/<owner>/<repo>-frontend:sha-<full-commit-sha>`
- Matching version tags, such as `v1.0.0`, for tag-triggered runs.

Names are lowercased. Manual publication is allowed on the default branch or a `v*` tag. Other branches verify but do not publish. No mutable `latest` tag is added. Do not move release tags; use image digests for deployments. Two-image publication is not atomic: check that both jobs succeeded before consuming the release.

Local Compose still builds local images; it does not automatically consume GHCR releases. A hosted environment needs an override or orchestrator configuration selecting both published images, migration/backup procedures, health checks, and rollback. Database rollback must account for schema compatibility.

Select hosting/domain, TLS, secure cookies, exact public origin, secret storage, durable volumes, and deployment credentials before adding server deployment automation. No automatic server deployment is claimed by this workflow.

Actions use major-version tags with Dependabot updates. Stronger supply-chain controls can pin reviewed action SHAs and image digests. Maintain backend constraints alongside dependency changes. Compose image versions also need separate review; Dockerfile updates do not cover every Compose service image.

Reference: [GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
