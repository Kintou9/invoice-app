# CI/CD setup

`ci-cd.yml` runs on every push/PR to `main`:

- **CI (always):** installs deps, builds, tests the frontend; installs deps and
  syntax-checks the backend (no backend test suite exists yet — see note below).
- **CD (push to `main` only):** deploys the frontend build and the backend to
  two Azure App Service instances.

The App Service resources don't exist yet, so the deploy jobs will fail until
you do the one-time setup below.

## 1. Create the App Service resources

Pick real names (the workflow assumes `invoice-app-backend` and
`invoice-app-frontend` — update the `app-name:` fields in `ci-cd.yml` if you use
different ones) and a resource group, then, via the Azure CLI:

```bash
az group create --name invoice-app-rg --location eastus

# Backend — Node 22 LTS Linux plan
az appservice plan create --name invoice-app-plan --resource-group invoice-app-rg --is-linux --sku B1
az webapp create --name invoice-app-backend --resource-group invoice-app-rg \
  --plan invoice-app-plan --runtime "NODE:22-lts"

# Frontend — same plan, also Node 22 LTS (serves the static build via `serve`)
az webapp create --name invoice-app-frontend --resource-group invoice-app-rg \
  --plan invoice-app-plan --runtime "NODE:22-lts"
az webapp config set --name invoice-app-frontend --resource-group invoice-app-rg \
  --startup-file "pm2 serve /home/site/wwwroot --no-daemon --spa"
```

(Or create both through the Azure Portal — "Create Web App" — with the same
settings.)

## 2. Configure backend Application Settings

In the Azure Portal, on the **backend** App Service → Settings →
Environment variables, add everything from `invoice-backend/.env.example`:

- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` (point at
  `invoicedb1.postgres.database.azure.com`)
- `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_CONTAINER_NAME` (`invoices`)
- `ANTHROPIC_API_KEY`
- `FRONTEND_URL` — set to `https://invoice-app-frontend.azurewebsites.net`

These are runtime secrets and never go in the repo or the workflow file.

## 3. Add GitHub repo secrets/variables

Repo → Settings → Secrets and variables → Actions:

**Secrets:**
- `AZURE_BACKEND_PUBLISH_PROFILE` — output of
  `az webapp deployment list-publishing-profiles --name invoice-app-backend --resource-group invoice-app-rg --xml`
- `AZURE_FRONTEND_PUBLISH_PROFILE` — same command with `invoice-app-frontend`

**Variables** (optional):
- `FRONTEND_API_URL` — the backend's public URL + `/api`, e.g.
  `https://invoice-app-backend.azurewebsites.net/api`. Baked into the frontend
  bundle at build time; defaults to that URL if unset.

## Known gaps

- **Backend has no test suite yet.** `invoice-backend/package.json`'s `test`
  script is still the unmodified npm placeholder that exits 1, so CI runs a
  `node --check` syntax smoke-check instead. Add real tests and swap the
  `test` script + workflow step when ready.

