# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Hermes Workspace is a React 19 + TanStack Start web application that serves as the UI command center for [NousResearch hermes-agent](https://github.com/NousResearch/hermes-agent). It is a **zero-fork** project — it runs against vanilla `nousresearch/hermes-agent` with no custom patches, using only public endpoints.

## Commands

```bash
pnpm dev              # Start dev server (auto-starts hermes gateway if not running)
pnpm build            # Production build → dist/
pnpm start            # Run built server (node server-entry.js)
pnpm test             # Run all unit tests (vitest run)
pnpm lint             # ESLint check
pnpm check            # Format + lint fix (prettier --write && eslint --fix)
pnpm electron:dev     # Run Electron app in dev mode
pnpm electron:build   # Build Electron distributable
pnpm smoke:managed    # Docker smoke test (HTTP 200 check)
```

**Run a single test file:**
```bash
pnpm vitest run src/server/auth-middleware.test.ts
```

**TypeScript check (no emit):**
```bash
pnpm tsc --noEmit
```

## Architecture

### Runtime Shape

The app is a full-stack SSR app via **TanStack Start** (built on Vite + TanStack Router). `server-entry.js` wraps `dist/server/server.js` as a Node HTTP handler. Routes in `src/routes/` map 1:1 to pages; `src/routeTree.gen.ts` is auto-generated (do not edit manually).

### Two Chat Backends

The core design decision is dual-mode chat in `src/server/chat-backends.ts`:

- **Enhanced mode** — proxies to Hermes Agent gateway (`HERMES_API_URL`, default `http://127.0.0.1:8642`). Enables sessions, memory, skills, jobs, MCP, and terminal.
- **Portable mode** — directly calls any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, OpenRouter). Chat-only; no agent features.

`src/lib/feature-gates.ts` probes upstream endpoints on startup and degrades gracefully to "Not Available" when capabilities are missing rather than crashing.

### Server vs. Client Boundary (Critical)

`src/types/mcp-input.ts` contains MCP types that carry **unmasked secrets** (API keys, tokens). An ESLint rule in `eslint.config.js` hard-blocks its import from client code. Client code must import from `@/types/mcp` instead. This is enforced at lint time — do not bypass it.

### Security Enforcement

`src/server/auth-middleware.ts` gates every API route. Key behaviors:
- Cookie-based session tokens with timing-safe comparison
- **Fail-closed**: if `HOST=0.0.0.0` (non-loopback) and `HERMES_PASSWORD` is unset, the server refuses to start
- Path-traversal prevention uses `fs.realpath` boundary checks (not string prefix matching)
- Rate limiting on high-risk endpoints

### State Management

- **Zustand** stores in `src/stores/` handle client state (approvals, auth, active users, connection errors)
- Config persisted to `~/.hermes/workspace-overrides.json` via `src/server/hermes-config-store.ts`
- Sessions in `~/.hermes/workspace-sessions.json` (encrypted tokens)
- Agent memory in `~/.hermes/` (MEMORY.md + daily files), browsed via `src/server/external-memory-browser.ts`

### Multi-Agent Orchestration

`swarm.yaml` defines 10 semantic workers (orchestrator, builder, reviewer, qa, researcher, ops, maintainer, strategist, km-agent, inbox-triage). `src/lib/workspace-agents.ts` dispatches tasks by role. `AGENTS.md` defines the human-readable roster and **greenlight gates** — operations that require explicit approval before execution (merge, publish, destructive, external-send, credential-change).

### Key File Map

| File | Purpose |
|------|---------|
| `src/router.tsx` | TanStack Router configuration (entry point) |
| `src/server/gateway.ts` | Hermes Agent API client (all upstream calls) |
| `src/server/auth-middleware.ts` | Auth enforcement for every API route |
| `src/lib/feature-gates.ts` | Capability detection + graceful degradation |
| `src/lib/workspace-agents.ts` | Multi-agent task dispatch |
| `src/types/mcp-input.ts` | Server-only secret-bearing MCP types |
| `swarm.yaml` | Semantic worker roster + greenlight gates |
| `vite.config.ts` | Build config; also auto-starts gateway in dev |
| `server-entry.js` | Node HTTP wrapper (production entrypoint) |
| `.env.example` | All supported environment variables with explanations |

## Toolchain

- **Package manager:** pnpm 10 (monorepo with `pnpm-workspace.yaml`)
- **Build:** Vite 7 + TanStack Start plugin
- **Styling:** Tailwind CSS 4 (via `@tailwindcss/vite`)
- **TypeScript:** strict mode, `@/*` aliases to `./src/*`, target ES2022
- **Formatting:** Prettier — `semi: false`, single quotes, trailing commas everywhere
- **Tests:** Vitest 3

## Environment

Copy `.env.example` to `.env`. The required variables for local dev are:
- An LLM provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) — or none if using Ollama
- `HERMES_API_URL` if hermes-agent runs on a non-default port

For remote (non-localhost) deployments, `HERMES_PASSWORD` is mandatory — the server will not start without it when bound to `0.0.0.0`.

## Docker

```bash
docker compose up          # Pull + run hermes-agent + workspace (fastest start)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up  # Build workspace from source
```

The workspace container mounts `hermes-agent-data` read-only at `/home/workspace/.hermes` so it shares the agent's memory and config.
