<!-- BGP-ADMIN:BEGIN -->
<!-- Managed by bgp-admin (templates/agent-docs). Edits inside this block are overwritten on the next sync. Add project-specific notes below the END marker. -->

# AGENTS.md

Instructions for AI coding agents working on this repository.

This repo is a **web game**. It is published as an iOS/Android app by a separate
control plane called **bgp-admin** — see "Native boundary" below, it is the rule
that matters most here.

Read also:

- [docs/agents/working-style.md](./docs/agents/working-style.md) — how the maintainer likes to work

## Native boundary

bgp-admin owns everything native. It generates the Capacitor setup, the signing
config and the release workflows from outside this repo, without modifying it.

**Never add or edit any of the following here:**

- `capacitor.config.*`, `ios/`, `android/`
- Capacitor or native plugin dependencies in `package.json`
- `.github/workflows/deploy*.yml`, `.github/workflows/preview-deploy.yml`
- Build config (`vite.config.*`, router config, base paths) changed *for the sake
  of the mobile build*

If something only breaks inside the app shell — blank screen in the WebView,
asset paths, deep links, splash screen, versioning, signing — the fix belongs in
bgp-admin, not here. Say so instead of patching around it. A local fix will be
silently overwritten on the next sync and will hide the real bug.

Normal web work (game logic, UI, assets, web build config for web reasons) is
entirely yours.

## Language

Everything you write into the repository MUST be in English:

- Source code (variables, functions, classes, file names)
- Comments of any kind
- Documentation, README files, guides
- Commit messages, branch names, PR and issue titles and descriptions
- Log messages and error messages
- Tests (descriptions, assertions, fixtures)
- Comments inside config files (YAML, JSON, TOML)
- Database schemas and API route names

Only end-user-facing content may be localized: UI strings in i18n files, store
listings, and marketing copy.

The maintainer communicates in Spanish. You may reply in Spanish in
conversation, but anything committed to the repository stays in English.

## Keeping this file current

At the end of a working session, update `AGENTS.md` with everything important
you learned that day. Worth recording:

- Conventions and patterns of this codebase that were not obvious up front
- Commands that actually work (build, test, lint, run) and their gotchas
- Decisions the maintainer made, and the reasoning behind them
- Traps you fell into, so the next agent does not repeat them

Do not record what the code already says, one-off details of a single task, or a
changelog of what you did. This file is for what the next agent needs to know
before starting, nothing else. Keep it edited down — replace stale entries
instead of appending to them.

Write project-specific notes **below the `BGP-ADMIN:END` marker**. Anything
inside the managed block is shared across all game repos and gets overwritten on
the next sync; if a rule you are adding applies to every game, it belongs in
bgp-admin at `templates/agent-docs/`, so ask before adding it.

<!-- BGP-ADMIN:END -->

# AGENTS.md

Instructions for AI coding agents (GitHub Copilot, Claude, Cursor, etc.) working on this repository.

## Language Policy

**All code-related content MUST be written in English**, including:

- ✅ Source code (variable names, function names, class names, file names)
- ✅ Code comments (single-line, block, JSDoc, TSDoc, etc.)
- ✅ Documentation files (`.md`, README, guides, ADRs)
- ✅ Commit messages
- ✅ Pull request titles and descriptions
- ✅ Issue titles and descriptions
- ✅ Git branch names
- ✅ Log messages and error messages
- ✅ Tests (descriptions, assertions, fixtures)
- ✅ Configuration files (comments inside YAML, JSON, TOML, etc.)
- ✅ Database schemas (table names, column names, comments)
- ✅ API endpoints and route names
- ✅ Environment variable names
- ✅ **Every UI string in this console** — button labels, dialog copy, toasts, empty
  states, placeholders, tooltips, validation messages, docs pages

## The bgp-admin Console UI Is English-Only

bgp-admin is an internal operator tool, not a player-facing product. There is no i18n
layer here and none is wanted: **write every visible string in English**, hardcoded.
Never introduce Spanish UI copy, and translate any Spanish string you come across while
working nearby.

## What Can Be in Other Languages

Only **player-facing content in the game repos** may be localized:

- ✅ Game UI strings shown to players (via their i18n files)
- ✅ Marketing copy / App Store / Play Store descriptions
- ✅ Player-facing email templates
- ✅ Translated content stored in i18n/locale files (e.g., `es.json`, `en.json`)

This exception does **not** extend to bgp-admin's own interface.

## Communication With the Maintainer

The maintainer of this repository communicates in **Spanish**. AI agents may respond to the maintainer in Spanish during conversations, but **any code, comment, or document produced MUST still be in English**.

## Examples

### ✅ Correct

```typescript
// Validates the user's deployment permissions before triggering the workflow
async function validateDeployPermissions(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("User not found");
  }
  return user.canDeploy;
}
```

### ❌ Incorrect

```typescript
// Valida los permisos de deploy del usuario antes de lanzar el workflow
async function validarPermisosDeploy(idUsuario: string): Promise<boolean> {
  const usuario = await obtenerUsuarioPorId(idUsuario);
  if (!usuario) {
    throw new Error("Usuario no encontrado");
  }
  return usuario.puedeDesplegar;
}
```

## Rationale

- Consistency across the whole codebase
- Easier onboarding for any future contributor
- Better compatibility with tooling, linters, and AI assistants
- Industry-standard practice in open-source and professional software development
