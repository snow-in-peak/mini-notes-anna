# Mini Notes with LLM Summary — Anna App

A local Anna App that lets a user create, view, delete, and summarize short notes.

The important platform path is:

```text
Anna App iframe
  -> AnnaAppRuntime.connect()
  -> anna.storage.get / anna.storage.set for notes
  -> anna.tools.invoke({ tool_id: "bundled:mini-notes-summary", method: "summarize", args })
  -> local Executa Tool over JSON-RPC 2.0 stdio
  -> reverse JSON-RPC sampling/createMessage
  -> host LLM or mock sampling fixture
  -> summary returned to the UI
```

This project intentionally does not call `localStorage`, IndexedDB, a local HTTP API, or a direct frontend LLM API for the core note and summary flows.

## Project structure

```text
mini-notes-anna/
├── app.json
├── manifest.json
├── package.json
├── index.html
├── src/
│   ├── App.tsx                # React UI
│   ├── annaRuntime.ts         # AnnaAppRuntime.connect wrapper
│   ├── constants.ts           # tool/storage identities
│   ├── storage.ts             # anna.storage.get / anna.storage.set
│   ├── tools.ts               # anna.tools.invoke wrapper
│   ├── types.ts
│   └── styles.css
├── executas/
│   └── mini-notes-summary-go/
│       ├── executa.json       # local + binary distribution metadata
│       ├── go.mod
│       └── main.go            # JSON-RPC 2.0 stdio Executa Tool
├── fixtures/
│   └── mock-sampling.jsonl    # anna-app executa dev --mock-sampling fixture
├── scripts/
│   ├── executa-manifest.sh    # shared archive-root manifest.json + archive helpers
│   ├── package-executa.sh     # build archive for current host platform
│   └── package-all-executa.sh # build + verify the three required release archives
├── tests/
│   └── manual-rpc.mjs         # direct JSON-RPC smoke test with sampling response mock
└── .github/workflows/
    └── release.yml            # GitHub Release assets workflow
```

## Ubuntu prerequisites

On Ubuntu, install Node.js 22+, npm, Go 1.21+, zip, unzip, and tar.

Example using Ubuntu packages plus NodeSource:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg git tar gzip zip unzip build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs golang-go
node --version
npm --version
go version
```

Install the Anna CLI according to your Anna developer environment. If `anna-app` is available globally, the npm scripts below will use it directly. If your environment exposes it through a package manager, run the equivalent command, for example `npx anna-app ...` or `pnpm anna-app ...`.

## Install dependencies

```bash
cd mini-notes-anna
npm install
```

For reproducible CI, commit `package-lock.json` after running `npm install`, then use:

```bash
npm ci
```

## Build the frontend bundle

```bash
npm run build
```

Expected output:

```text
bundle/index.html
bundle/assets/...
```

`manifest.json` points Anna to `ui.bundle.entry = "index.html"` inside the Anna bundle directory; after build, the file exists at `bundle/index.html`.

## Validate the Anna App manifest

```bash
npm run validate
# equivalent:
anna-app validate --strict
```

This should be run after `npm run build` so the validator can see the static bundle entry declared by the manifest.

## Run the UI harness without login or LLM

```bash
npm run dev:ui
# equivalent:
anna-app dev --no-llm
```

Open the harness URL printed by the CLI. In the app:

1. Add a note.
2. Delete a note.
3. Watch the harness RPC log.

Evidence that storage is correct:

- `src/storage.ts` only reads through `anna.storage.get({ key })`.
- `src/storage.ts` only writes through `anna.storage.set({ key, value })`.
- The harness RPC log should show storage `get` on load and storage `set` after create/delete.

The app does not use browser `localStorage`, IndexedDB, files, or a direct HTTP backend for notes.

## Expected Summarize behavior under `--no-llm`

Still click **Summarize** while running:

```bash
anna-app dev --no-llm
```

The frontend still calls:

```ts
anna.tools.invoke({
  tool_id: 'bundled:mini-notes-summary',
  method: 'summarize',
  args: { notes }
})
```

Because `--no-llm` disables harness LLM/sampling, the Summarize action is expected to fail with an error similar to:

```text
[-32603] harness started with --no-llm
```

That error is the expected UI harness path. It proves the UI is wired to `anna.tools.invoke`; it does not mean the backend Executa sampling implementation is broken. Backend sampling is tested separately with `anna-app executa dev --mock-sampling`.

## Test backend sampling with mock fixture

Run this from the repository root:

```bash
npm run executa:mock
# equivalent:
cd executas/mini-notes-summary-go
../../node_modules/.bin/anna-app executa dev --mock-sampling ../../fixtures/mock-sampling.jsonl
```

At the `executa>` prompt (the REPL accepts `invoke <tool> <json-args>`), type:

```text
invoke summarize {"notes":[{"order":1,"content":"明天跟客户 follow up"},{"order":2,"content":"修复登录 bug"},{"order":3,"content":"Workshop 内容想法"}]}
```

The fixture returns a fixed summary, so the expected response is:

```json
{
  "invoke_id": "local-...",
  "model": "mock-model",
  "summary": "Mock summary: 你有 3 条笔记，重点是客户跟进、登录 bug 修复和 Workshop 内容准备。"
}
```

If `summary` comes back as `"(mock) no fixture matched"`, the fixture is not being
matched. The sampling bridge selects a fixture line by its **top-level `ns` +
`method`** fields — either `ns: "sampling"` / `method: "createMessage"` or
`ns: "llm"` / `method: "complete"` — and returns that line's `result`. A line
without those top-level keys never matches. `fixtures/mock-sampling.jsonl` uses
the `llm`/`complete` form; lines beginning with `#` are ignored as comments.

The same path can be exercised non-interactively:

```bash
cd executas/mini-notes-summary-go
../../node_modules/.bin/anna-app executa dev \
  --mock-sampling ../../fixtures/mock-sampling.jsonl \
  --invoke summarize \
  --args '{"notes":[{"order":1,"content":"明天跟客户 follow up"}]}' --json
```

How to confirm `sampling/createMessage` was actually emitted:

- The Executa dev harness log should show a reverse JSON-RPC request with `method: "sampling/createMessage"`.
- The returned `summary` is the fixture text and `model` is `mock-model`, which proves the reverse call happened rather than a local fallback.
- `tests/manual-rpc.mjs` also checks this directly without the Anna CLI.

## Manual JSON-RPC tests

Build the Executa binary for your Ubuntu host:

```bash
cd executas/mini-notes-summary-go
go build -o mini-notes-summary .
cd ../..
```

Run the included direct protocol smoke test:

```bash
npm run test:rpc
```

Expected output:

```text
manual-rpc OK: initialize, describe, invoke, and sampling/createMessage verified
```

The script verifies:

- `initialize` negotiates protocol v2 and returns `client_capabilities.sampling = {}`.
- `describe` returns the bare tool manifest with `host_capabilities: ["llm.sample"]`.
- `describe.tools[].parameters` uses the Anna Executa `parameters[]` shape.
- `invoke` emits a reverse JSON-RPC `sampling/createMessage` request.
- The final `summary` comes from the sampling response text.

You can also test `initialize` and `describe` manually:

```bash
cd executas/mini-notes-summary-go
go build -o mini-notes-summary .
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2.0"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"describe"}' \
  '{"jsonrpc":"2.0","id":3,"method":"health"}' \
  '{"jsonrpc":"2.0","id":4,"method":"shutdown"}' \
  | ./mini-notes-summary
```

A full manual `invoke` requires replying to the reverse `sampling/createMessage` on the same stdin stream. Use `npm run test:rpc` for that coverage because it acts as a tiny host and sends the sampling response back.

## Build Executa binary archive on Ubuntu

The local packaging script detects the current host architecture and builds an archive runnable on that platform:

```bash
npm run package:executa
# equivalent:
bash scripts/package-executa.sh
```

On Ubuntu x86_64 this produces:

```text
release/mini-notes-summary-linux-x86_64.tar.gz
release/mini-notes-summary-linux-x86_64.tar.gz.sha256
```

Although Linux is not one of the required release platforms in the prompt, this is useful for local Ubuntu testing.

To build the three required release assets from Ubuntu via Go cross-compilation:

```bash
npm run package:executa:all
# equivalent:
bash scripts/package-all-executa.sh
```

Expected required assets:

```text
release/mini-notes-summary-darwin-arm64.tar.gz
release/mini-notes-summary-darwin-x86_64.tar.gz
release/mini-notes-summary-windows-x86_64.zip
```

Each archive has `manifest.json` at the archive root and the executable under `bin/`.
`npm run package:executa:all` verifies this layout itself and fails if either file is
missing or if the manifest entrypoint disagrees with the packaged binary.

Inspect the archive listings:

```bash
tar -tzf release/mini-notes-summary-darwin-arm64.tar.gz
unzip -l release/mini-notes-summary-windows-x86_64.zip
```

Expected archive roots:

```text
manifest.json
bin/mini-notes-summary
```

and for Windows:

```text
manifest.json
bin/mini-notes-summary.exe
```

To read the manifest out of an archive:

```bash
mkdir -p /tmp/mini-notes-check
tar -xzf release/mini-notes-summary-darwin-arm64.tar.gz -C /tmp/mini-notes-check
cat /tmp/mini-notes-check/manifest.json
```

The archive root `manifest.json` declares:

```json
{
  "name": "mini-notes-summary",
  "display_name": "Mini Notes Summary",
  "version": "0.1.0",
  "description": "Summarizes Mini Notes by requesting host LLM sampling over reverse JSON-RPC.",
  "platform": "darwin-arm64",
  "runtime": {
    "type": "binary",
    "entrypoint": "bin/mini-notes-summary"
  },
  "permissions": [],
  "host_capabilities": ["llm.sample"]
}
```

`platform` is the archive's own platform key (`darwin-arm64`, `darwin-x86_64`, or
`windows-x86_64`). Both macOS archives use entrypoint `bin/mini-notes-summary`;
`windows-x86_64` uses `bin/mini-notes-summary.exe`.

Note that Anna resolves the binary it launches from
`distribution.profiles.binary.binary_urls["<platform>"].entrypoint` in
`executas/mini-notes-summary-go/executa.json`. The archive-root `manifest.json` is
descriptive metadata that must agree with it — `scripts/executa-manifest.sh` is the
single source for both packaging scripts so the two cannot drift.

## GitHub Actions release workflow

Workflow file:

```text
.github/workflows/release.yml
```

Trigger manually:

```text
GitHub -> Actions -> Release Executa Binaries -> Run workflow
```

Or push a tag:

```bash
git tag mini-notes-summary-v0.1.0
git push origin mini-notes-summary-v0.1.0
```

The workflow:

1. Installs Go and Node.
2. Builds the frontend bundle.
3. Builds a Linux smoke-test binary.
4. Sends a `describe` JSON-RPC request and checks the response.
5. Builds the three required release assets:
   - `mini-notes-summary-darwin-arm64.tar.gz`
   - `mini-notes-summary-darwin-x86_64.tar.gz`
   - `mini-notes-summary-windows-x86_64.zip`
6. Uploads them to GitHub Release assets, not only workflow artifacts.

Binary release URLs in `executas/mini-notes-summary-go/executa.json` point to this repository's GitHub Releases.

## Identity consistency checklist

These values intentionally match:

```text
manifest.json required_executas[0].tool_id  = bundled:mini-notes-summary
manifest.json ui.host_api.tools[0]          = required:bundled:mini-notes-summary
src/constants.ts TOOL_ID                    = bundled:mini-notes-summary
executas/.../executa.json tool_id           = bundled:mini-notes-summary
Executa describe result tool_id             = bundled:mini-notes-summary
Frontend invoke method                      = summarize
Executa describe tools[0].name              = summarize
Executa invoke accepted method              = summarize
```

## How the Anna pieces relate

- `manifest.json`: declares the Anna App surface, permissions, required Executa, UI bundle entry, views, Host API permissions, and local dev fixtures.
- `bundle/`: the static frontend bundle generated by Vite. Anna loads it in the app iframe.
- `AnnaAppRuntime.connect()`: connects the iframe to the Anna UI Runtime and exposes `anna.*` Host APIs.
- Anna storage / APS KV: the app uses `anna.storage.get` and `anna.storage.set`; in no-login local harness this maps to legacy in-memory `runtime_state`, while real Anna can back it with APS KV semantics.
- `anna.tools.invoke`: the only summary route from the UI to the local Executa Tool.
- Executa Tool: a long-running JSON-RPC 2.0 stdio process. It keeps reading stdin until EOF and writes only JSON-RPC messages to stdout. Logs go to stderr.
- Sampling: the Executa does not own an LLM key. During `invoke`, it sends reverse JSON-RPC `sampling/createMessage` to the host and returns the host/mock sampling response as the summary.
- Binary archive: the release asset contains an archive-root `manifest.json` and a `bin/` entrypoint so Anna Agent can install and launch the Executa binary.

## Submission steps

```bash
cd mini-notes-anna
git init
git add .
git commit -m "Implement Mini Notes Anna App"
git branch -M main
git remote add origin git@github.com:<OWNER>/<REPO>.git
git push -u origin main
```

Submit the resulting GitHub repository URL.
