# Contributing

Read the [root guide](README.md) and [architecture](full-product/docs/ARCHITECTURE.md) first. Use a feature branch and a focused pull request describing behavior and verification.

Use Node.js 22 and Python 3.12 to match CI. Run `npm ci` in each JavaScript application. Install backend dependencies with `python -m pip install -c requirements.lock -r requirements.txt -r requirements-dev.txt` from `full-product/backend` in a virtual environment.

Run the checks for your component listed in [Verification](full-product/docs/VERIFICATION.md). Database changes need an Alembic migration and a backup/restore strategy. Preserve workspace authorization, CSRF protection, role checks, and the distinction between demonstration data and live evidence.

Never commit `.env`, session cookies, `.e2e`, raw datasets, database dumps, uploads, or model weights. Synthetic fixtures should be small and clearly labeled. Do not run product browser tests against a personal deployment.

For dependency changes, update the corresponding npm lockfile or backend constraints and validate a clean install on Python 3.12. Dependabot proposals do not replace compatibility or dataset-license review.

Code owners and a software license must be selected by the repository owner; neither is implied by this contribution guide.
