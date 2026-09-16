# CLAUDE.md

## Read first

- **[`docs/README.md`](docs/README.md)** — the documentation index. Start there.
- **[`docs/02-architecture-overview.md`](docs/02-architecture-overview.md)** — how the two
  processes fit together.
- **[`docs/03-ai-teaching-loop.md`](docs/03-ai-teaching-loop.md)** — the teaching loop.
  Read before touching anything AI-related.
- **[`docs/13-troubleshooting.md`](docs/13-troubleshooting.md)** — disk/memory kills, no-git,
  and why your backend edit did nothing.
- `REMOVAL_SUMMARY.md` and `EXCALIDRAW_LINKS_REMOVAL.md` are historical cleanup logs, not
  architecture. Their AI section is explicitly marked outdated.

## Critical environment facts

- **Version control:** this is a git repository on `main`, tracking `origin` at
  https://github.com/DeepakChander/amatic (private). Use normal git workflow — no scratch-directory
  backups needed. There is no CI, so nothing checks a push.
- **Canonical checkout is `D:\amatic-main`.** Moved off `C:\...\OneDrive\...` because
  `node_modules` is ~78,000 files and OneDrive syncing them starved C: (see
  [`docs/20-storage-and-capacity.md`](docs/20-storage-and-capacity.md)). A stale copy may
  still exist under OneDrive — do not work in it.
- **The AI does not run without `.env.local`** at the repo root (sibling of
  `package.json`), holding `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` and
  `ELEVENLABS_API_KEY`. Copy `.env.example` to start. Check key *presence* with
  `GET localhost:3001/health` and whether the keys actually *work* with
  `GET localhost:3001/readyz`.
- **Install with `corepack yarn install --frozen-lockfile`.** A bare `yarn install`
  rewrites `yarn.lock` into a semver-invalid state (`strip-ansi@^7.0.1` folded into the
  6.0.1 entry). Revert any unexplained lockfile diff.
- **The test suite has ~138 pre-existing failures across 16 files** on untouched code.
  Diff the failing-file set against that baseline before assuming a change broke
  something. `tsc --noEmit` is clean at 0 errors; `yarn test:code` (eslint) already fails.
- `yarn` may not be on PATH. `corepack yarn` resolves to the pinned 1.22.22.

## Project Structure

Amatic is a **monorepo** with a clear separation between the core library and the
application. Paths are lowercase — case matters on Linux and CI:

- **`packages/amatic/`** - Main React component library, published to npm as `@amatic/amatic`
- **`amatic-app/`** - Full-featured web application that uses the library
- **`packages/`** - Core packages: `@amatic/common`, `@amatic/element`, `@amatic/math`, `@amatic/utils`
- **`examples/`** - Integration examples (NextJS, browser script)
- **`docs/`** - Amatic-specific documentation (`dev-docs/` is the inherited Excalidraw site)

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `amatic-app/` for app-specific features
3. **Testing**: Run `yarn test:update` before committing — compare against the known
   baseline above rather than expecting a green suite
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn start           # Run the app: Vite (:3000) + Express AI backend (:3001)
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`); `@/*` maps to `amatic-app/*`
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration

### AI backend

- `amatic-app/server.js` is a separate Express process on :3001; Vite proxies `/api/*` to it
- It has **no watcher** — restart it after editing anything under `amatic-app/api/`
- `amatic-app/api/` is in `.eslintignore`, so `node --check` is the syntax gate there
- Model IDs live only in `amatic-app/api/ai/models.js`; never inline a model string
