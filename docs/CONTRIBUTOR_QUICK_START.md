# Contributor Quick Start

This guide takes a new contributor from a clean clone to a running PaymentFlow frontend and backend.

## Prerequisites

Install:

- Git
- Node.js 20.11.0 from `.nvmrc`
- npm
- Docker Engine with Docker Compose v2
- `curl` and `openssl`

Check the toolchain:

```bash
node --version
npm --version
docker compose version
```

## Clone And Install

```bash
git clone https://github.com/onlyonee1/PaymentFlow.git
cd PaymentFlow

npm ci
(cd backend && npm ci)
(cd frontend && npm ci)
```

The root install provides repository-wide tests. The backend and frontend installs provide their package-local tests, linting, and development commands.

## Configure Environment

Create local files from the checked-in templates:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Use the [environment variable reference](environment-reference.md) for defaults, sensitivity, ownership, rotation, and scope.

For the default Docker workflow, edit the root `.env` and set local-only values for `MONGO_ROOT_PASSWORD`, `JWT_SECRET`, and `ADMIN_PASSWORD`. Keep `MONGO_ROOT_USERNAME=root`. Generate values without printing them to logs:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

For host-run backend commands, set `MONGO_URI=mongodb://localhost:27017/stellaredupay`, the same local `JWT_SECRET`, and `REDIS_HOST=localhost` in `backend/.env`. Keep `NEXT_PUBLIC_API_URL=/api` and `NEXT_PUBLIC_STELLAR_NETWORK=testnet` in `frontend/.env.local` so Next.js proxies browser API calls to the backend.

`SCHOOL_WALLET_ADDRESS` is optional at startup. A valid Stellar testnet address is needed only for seed or migration flows; use synthetic local data and never commit private keys, credentials, or personal data.

## Start The Application

Use the complete Compose stack. MongoDB is a required single-node replica set and its port is intentionally not published to the host:

```bash
docker compose up --build -d --wait
```

Verify the stack:

```bash
docker compose ps
curl http://localhost:5000/health
curl -I http://localhost:3000
```

Open:

- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:5000/health>
- API docs in development: <http://localhost:5000/api/docs>

Compose runs pending migrations before starting the backend. Do not start a second backend or frontend on the same ports while the Compose services are running.

Stop the stack without deleting local database data:

```bash
docker compose down
```

To discard local MongoDB data and initialize again:

```bash
docker compose down -v
docker compose up --build -d --wait
```

## Tests And First Change

Run the focused repository checks from the root:

```bash
npm test -- --runInBand
(cd backend && npm test -- --runInBand)
(cd frontend && npm test -- --runInBand)
```

For a backend change, also run:

```bash
(cd backend && npm run lint)
```

For a frontend rendering or routing change, also run:

```bash
(cd frontend && npm run build)
```

Create a branch, make one small change, and inspect the diff:

```bash
git switch -c docs/my-first-change
# edit a file
git diff --check
```

For an application change, rebuild the affected Compose services and check the backend again:

```bash
docker compose up --build -d backend frontend
curl http://localhost:5000/health
```

## Troubleshooting

### Compose fails before starting

Check required root variables and the first failing service:

```bash
docker compose ps
docker compose logs --tail=100 mongo
docker compose logs --tail=100 backend
```

MongoDB and backend credentials come from the root `.env`. Do not paste `.env` files or credential-bearing logs into issues. If MongoDB was initialized with incompatible local credentials, use `docker compose down -v` and start again.

### Backend is unhealthy

The backend requires `MONGO_URI` and `JWT_SECRET`. Confirm MongoDB is healthy, then inspect readiness:

```bash
docker compose ps mongo
curl http://localhost:5000/health/ready
docker compose logs --tail=100 backend
```

A `degraded` health response can indicate a temporary Stellar Horizon or Redis problem. MongoDB connectivity determines whether the backend is `unhealthy`. Inside a container, never use `localhost` for MongoDB; Compose supplies the internal Mongo URI.

### Frontend cannot reach the API

Keep `NEXT_PUBLIC_API_URL=/api` in `frontend/.env.local`, confirm the backend is listening on port 5000, and restart the frontend after changing any `NEXT_PUBLIC_*` value. The development proxy defaults to `http://localhost:5000`.

### Tests fail before running

Run `npm ci` in the directory whose test command failed. Use the root command for repository tests, `backend/npm test` for backend tests, and `frontend/npm test` for frontend tests. Integration, end-to-end, load, and Docker health-check suites are opt-in and require the services described by their root `package.json` scripts.

### Seed data is missing

The optional seed script reads `backend/.env` and needs host-reachable MongoDB plus a valid Stellar public address:

```bash
npm run seed
```

The default Compose file does not publish MongoDB to the host, so use a local MongoDB or a deliberate localhost-only Compose override. The seed defaults to the synthetic `SCH001` demo school and is safe to rerun.

## Useful Commands

```bash
docker compose logs -f backend
docker compose restart backend
(cd backend && npm run migrate)
(cd backend && npm run dev)
(cd frontend && npm run dev)
```

Use host-run `dev` commands only after stopping the corresponding Compose service. The host-run backend requires MongoDB and Redis to be reachable from the host.
