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

- **This is NOT a git repository.** There is no `git checkout`, stash, or diff against
  HEAD. Back up any file to a scratch location before editing or deleting it.
- **The AI does not run without `.env.local`** at the repo root (sibling of
  `package.json`), holding `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` and
  `ELEVENLABS_API_KEY`. Check with `GET localhost:3001/health`.
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
