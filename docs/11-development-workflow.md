# 11 — Development Workflow

## Monorepo layout

Yarn 1 workspaces, declared in the root `package.json`:

```json
"workspaces": ["amatic-app", "packages/*", "examples/*"]
```

Dependencies hoist to the root `node_modules`. `amatic-app/node_modules` holds only what
cannot hoist.

## Path aliases

| Alias | Resolves to |
|---|---|
| `@/*` | `amatic-app/*` |
| `@amatic/common` | `packages/common/src/index.ts` |
| `@amatic/amatic` | `packages/amatic/index.tsx` |
| `@amatic/element` | `packages/element/src/index.ts` |
| `@amatic/math` | `packages/math/src/index.ts` |
| `@amatic/utils` | `packages/utils/src/index.ts` |

Declared in **three** places that must stay in sync: `tsconfig.json` `paths`,
`amatic-app/vite.config.mts` `alias`, and `vitest.config.mts`. Adding an alias to only one
gives you code that typechecks but won't build, or builds but won't test.

## Commands

```bash
corepack yarn start          # both processes (Vite :3000 + Express :3001)
corepack yarn start:frontend # Vite only
corepack yarn start:server   # Express only

corepack yarn test:typecheck # tsc --noEmit — currently CLEAN (0 errors)
corepack yarn test           # vitest — see 12-testing.md before reading results
corepack yarn test:update    # vitest with snapshot updates
corepack yarn fix            # prettier + eslint --fix

corepack yarn build          # production build of the app
corepack yarn build:packages # rebuild all packages
corepack yarn rm:build       # clear build output
```

## Rules that will save you time

### 1. The backend has no watcher

Vite hot-reloads the frontend. **Express does not reload.** It `require`s handlers at
startup, so after editing anything under `amatic-app/api/` or `server.js` you must restart
it. Symptom: your change appears to do nothing.

Worth adding `nodemon` for the backend — see [18](18-implementation-plan.md) Phase 1.

### 2. `api/` is not linted

`amatic-app/api/` is in `.eslintignore`. `eslint` will report
*"File ignored because of a matching ignore pattern"* and pass. Your syntax gate there is:

```bash
node --check amatic-app/api/ai/master.js
```

### 3. Use `corepack yarn --frozen-lockfile`, never `npm install`

`npm install` creates a `package-lock.json` beside `yarn.lock` and breaks workspace
resolution. The pin is `yarn@1.22.22`.

Always pass `--frozen-lockfile`. A bare `yarn install` rewrites the lockfile, and the
rewrite this tree produces is semver-invalid: `strip-ansi@^7.0.1` gets folded into the
`strip-ansi@6.0.1` entry, handing a 7.x (ESM) consumer a 6.x (CJS) module. Revert any
unexplained `yarn.lock` diff that appears after an install you did not intend as a
dependency change.

### 4. Version control exists — use it

This is a git repository on `main`, tracking `origin` at https://github.com/DeepakChander/amatic
(private). Branch and commit normally; the scratch-directory backup habit from before the
repo existed is no longer needed.

There is **no CI**, so nothing validates a push. Run `test:typecheck` and the suite
yourself, and compare failures against the baseline in [12](12-testing.md).

### 5. Verify what goes on the wire, not just that it compiles

For provider calls, the cheapest real verification is a local sink: a tiny HTTP server plus
`ANTHROPIC_BASE_URL=http://127.0.0.1:9999`, then inspect the request body. It proves model
IDs, `max_tokens`, and that removed parameters are actually gone — without spending a
token. This is how the Sonnet 5 migration was validated.

## Editing patterns for `api/**`

These files are CommonJS (`require`, `module.exports`), unlike the TypeScript app. When
making mechanical edits across them:

- Prefer **literal string replacement with an occurrence assertion** over regex. A script
  that checks `split(needle).length - 1 === 1` and aborts otherwise leaves the file
  untouched on a mismatch — still the safer pattern for bulk edits, even with git.
- Line-number edits should assert the content of boundary lines first. During this
  project's history an off-by-two in a line range was caught only because the script
  asserted the closing line's text.
- Beware heredocs when the content contains backslashes or nested quotes; the shell will
  eat them. Write the file with a proper file-writing tool instead.

## Where to make a change

| Task | Location |
|---|---|
| Editor behaviour, tools, rendering | `packages/amatic/` |
| App shell, collaboration, footer | `amatic-app/` |
| The teaching loop | `amatic-app/hooks/useCanvasJarvis.ts` |
| Prompts, model config | `amatic-app/api/ai/` |
| Model IDs | `amatic-app/api/ai/models.js` **only** |
| Canvas placement | `useCanvasJarvis.ts` + `lib/ai/canvas-monitor.ts` |

## Before committing (once git exists)

```bash
corepack yarn test:typecheck                 # must stay at 0 errors
node --check amatic-app/api/**/*.js          # backend syntax
corepack yarn test                           # compare to the baseline in 12-testing.md
```

Do **not** rely on `yarn test:code` passing — eslint already fails on pre-existing unused
imports.

## Next

- [12-testing.md](12-testing.md)
- [13-troubleshooting.md](13-troubleshooting.md)
