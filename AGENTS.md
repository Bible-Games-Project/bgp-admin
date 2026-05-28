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

## What Can Be in Other Languages

Only **end-user-facing content** may be localized:

- ✅ UI strings shown to end users (via i18n files)
- ✅ Marketing copy / App Store / Play Store descriptions
- ✅ User-facing email templates
- ✅ Translated content stored in i18n/locale files (e.g., `es.json`, `en.json`)

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
