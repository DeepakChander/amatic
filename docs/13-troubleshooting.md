# 13 — Troubleshooting

## "Low memory" process kills — it's the disk, not the RAM

**Symptom:** dev servers die repeatedly with *"stopped because the system is running low on
memory"*, even though Task Manager shows free RAM.

**Measured on this machine (2026-09-07):**

```
C:    2.0 GB free of 161.5 GB   ← 1.2% free
D:  313.7 GB free of 313.8 GB   ← completely empty
RAM: 15.7 GB total
pagefile.sys: 18.5 GB, on C:, auto-managed
commit charge: 88-97%
```

**Root cause:** the pagefile is on C: and auto-managed. With ~2 GB free, **Windows cannot
grow it**, so commit charge hits its ceiling and the OS starts killing processes. Free RAM
is irrelevant when commit is exhausted.

### Fix, in order

**Step 1 — Move the pagefile to D:** (biggest win, ~18.5 GB back, removes the ceiling)

1. Win+R → `sysdm.cpl` → **Advanced**
2. Performance → **Settings** → **Advanced**
3. Virtual memory → **Change**
4. Uncheck *"Automatically manage paging file size"*
5. **C:** → *No paging file* → **Set**
6. **D:** → *System managed size* → **Set**
7. OK → **reboot**

To keep crash dumps working, leave a small 2 GB pagefile on C: instead of none.

**Step 2 — Empty the Recycle Bin.**

**Step 3 — Disk Cleanup:** Win+R → `cleanmgr` → C: → **Clean up system files** → check
Windows Update Cleanup, Temporary files, Delivery Optimization, Thumbnails.

**Step 4 — Move Downloads to D:** (6.5 GB here). Right-click
`C:\Users\Deepak\Downloads` → Properties → **Location** → Move → `D:\Downloads`.

After these four steps: ~25–30 GB free, and the kills stop.

**Step 5 — Find the rest.** `AppData` measures **50.09 GB**. Do not delete blindly —
measure subfolders first. The usual culprits:

| Suspect | Typical size | Action |
|---|---|---|
| WSL2 `ext4.vhdx` (under `AppData\Local\Packages`) | 20–40 GB | relocate with `wsl --export` / `wsl --import` |
| npm / yarn cache | 1–5 GB | `yarn cache clean`, then relocate the cache dir to D: |
| Browser caches | 1–3 GB | clear from the browser |
| Old VSCode extension versions | 1–2 GB | safe to prune |

## OneDrive syncing `node_modules`

The project sits inside the OneDrive sync root, and `node_modules` holds **74,378 files**.
OneDrive re-scans them after every install, holding ~500 MB–1 GB and thousands of handles
indefinitely.

**Fix — move the project off C: and out of OneDrive:**

1. Close all editors and terminals
2. Copy the project to `D:\amatic-main`
3. **Delete `node_modules` in the copy**, then `corepack yarn install` fresh
4. Verify it runs, *then* remove the original

Step 3 is not optional — copied `node_modules` carries absolute paths and symlinks that
break when moved.

## No git — fix this first

This working copy has no `.git`. No undo, no stash, no diff. Every mistake is permanent.

```bash
cd D:\amatic-main
git init
# .gitignore must include: node_modules, .env.local, build, dist, *.log
git add -A && git commit -m "Baseline"
```

Five minutes, free, and the single largest risk reduction available.

---

## Application problems

### `yarn: command not found`
Use `corepack yarn`. Never `npm install` — it breaks workspace resolution.

### `/health` shows all `false`
`.env.local` is missing or in the wrong place. It belongs at the **repo root**, beside the
root `package.json` — not inside `amatic-app/`. See [01](01-getting-started.md).

### Backend edits have no effect
Express has no watcher. **Restart it.** See [11](11-development-workflow.md).

### The canvas loads but the AI never responds

Work through this in order:

1. Is the backend up? `curl localhost:3001/health`
2. Do keys report `true`?
3. Is the mic on? The footer dot should be green.
4. Did you wait **3 full seconds** after drawing (`IDLE_DEBOUNCE_MS`)?
5. Are you inside the 15 s cooldown from a previous turn?
6. Was recognition low-confidence? The loop **deliberately stays silent** on a bad read.
7. Check the backend console — `master.js` logs errors there.

⚠️ **The client ignores `{"type":"error"}` from `master`.** A keyless or failing backend
produces total silence with no user feedback. That is a bug, not your setup.

### An image never appears

`dispatchWorker` silently drops any prompt beyond 3 concurrent, and `workerFailedRef`
latches on the first failure and blocks every later dispatch in that turn. So one Gemini
error kills the rest of the turn's visuals. See [03](03-ai-teaching-loop.md) Stage 4.

### 429 "Too many requests" during normal use

The limiter allows 100 requests/min per IP. One turn spends up to 3 worker calls plus one
TTS call **per sentence**, so a chatty turn can approach the limit alone. There is also no
`app.set("trust proxy")`, so behind a proxy every user shares one bucket.

### Tests fail
Almost certainly pre-existing. **Read [12-testing.md](12-testing.md) before debugging.**

### Voice input does nothing
Web Speech API is effectively Chrome/Edge only. Firefox and Safari users get a silent
tutor. Check `MIN_VOICE_CONFIDENCE` (0.65) if speech is being detected but ignored.

## Diagnostics worth keeping

```bash
# disk (check this FIRST on any "memory" problem)
powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select DeviceID,FreeSpace,Size"

# commit charge — the real memory ceiling on Windows
powershell -NoProfile -Command "$os=Get-CimInstance Win32_OperatingSystem; ($os.TotalVirtualMemorySize-$os.FreeVirtualMemory)/1KB"

# what's listening
netstat -ano | findstr LISTENING | findstr ":300"

# backend syntax (api/ is not linted)
node --check amatic-app/api/ai/master.js
```

## Next

- [14-dead-code.md](14-dead-code.md)
- [12-testing.md](12-testing.md)
