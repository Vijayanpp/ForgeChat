# Contributing to PitConnect

## Reporting bugs

Please open an issue describing:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Runtime environment (Node version, OS)
- Relevant logs or error messages

## Reporting security issues

**Do not file security issues publicly.** Contact the Pit Solutions team directly via email to report vulnerabilities privately.

## Development workflow

```bash
git clone <repo-url>
cd pitconnect
npm install
cp .env.local.example .env.local
npm run dev
```

See [SETUP.md](./SETUP.md) for full environment configuration.

## Code standards

All PRs must pass:

```bash
npm run typecheck    # TypeScript — zero errors
npm run lint         # ESLint
npm run format:check # Prettier
npm test             # Vitest unit tests
```

Run `npm run format` to auto-fix formatting before pushing.

## Commit style

- First line: imperative, terse (`Fix inbox unread count on reassign`)
- Body (optional): explain the *why*, not the *what* (the diff shows the what)
- One logical change per commit

## Pull requests

- Branch off `main`
- Fill in the PR description with what changed and why
- One logical change per PR
- Include a test plan for UI changes

## Dev commands

| Command | What it does |
|---|---|
| `npm run dev` | Turbopack dev server on port 3000 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier auto-format |
| `npm run format:check` | Prettier check (CI mode) |
| `npm test` | Run unit tests once |
| `npm run test:watch` | Run unit tests in watch mode |
