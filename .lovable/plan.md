
## Objetivo

Centralizar en `bgp-admin` todo el orquestador de publicación: las apps se dan de alta desde la UI, se guardan en BD, y desde aquí se dispara el deploy de iOS/Android en el repo de cada app, que solo contiene un workflow "caller" mínimo apuntando a los reutilizables de `bgp-admin`.

## 1) Base de datos (migración)

Tabla `apps` (gestionada solo por admins):

- `id` uuid PK
- `slug` text unique (p.ej. `eden`)
- `name` text (p.ej. "Eden — Choice Chronicles")
- `github_owner` text (`Bible-Games-Project`)
- `github_repo` text (`eden-choice-chronicles`)
- `default_ref` text default `main`
- `ios_bundle_id` text nullable (`com.biblegames.eden`)
- `ios_workflow_file` text default `deploy-ios.yml`
- `android_package_name` text nullable
- `android_workflow_file` text default `deploy-android.yml`
- `android_play_track` text default `internal`
- `notes` text nullable
- `is_active` boolean default true
- `created_at`, `updated_at` timestamptz

RLS: solo lectura/escritura para admins (vía `EXISTS (select 1 from admins where user_id = auth.uid())`). GRANTs a `authenticated` y `service_role`.

## 2) Server functions (`src/lib/apps.functions.ts` + refactor `deploy.functions.ts`)

- `listApps`, `getApp(id)`, `createApp(input)`, `updateApp(id, input)`, `deleteApp(id)` — todas con `requireSupabaseAuth` + check admin.
- `triggerDeploy({ appId, platform, ref? })`: lee el `app` de BD, construye la URL `…/repos/{owner}/{repo}/actions/workflows/{file}/dispatches` y dispara con `GITHUB_PAT` (ya existe en secrets).
- `listWorkflowRuns({ appId, platform })`: igual, pero `…/workflows/{file}/runs`.

## 3) UI admin

- `/_authenticated/apps` — listado de apps + botón "Nueva app".
- `/_authenticated/apps/$id` — detalle/edición con todos los campos.
- `/_authenticated/deploy` — refactor del panel actual: selector de app + tabs iOS/Android, botón Deploy, tabla de últimos runs (con link a GitHub).
- Entrada en `AppSidebar`: "Apps" y "Deploy".

## 4) Documentación dentro de la app

- `/_authenticated/docs` con una página Markdown-style que explique:
  - cómo dar de alta una nueva app
  - qué workflow caller pegar en su repo
  - qué secretos hace falta configurar en GitHub
  - permisos del `GITHUB_PAT`

## 5) Qué tienes que hacer en `eden-choice-chronicles`

Crear **solo dos ficheros** en el repo de la app:

`.github/workflows/deploy-ios.yml`
```yaml
name: Deploy iOS
on:
  workflow_dispatch:
    inputs:
      ref:
        description: Branch/tag
        required: false
        default: main
jobs:
  ios:
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-ios.yml@main
    with:
      bundle-id: com.biblegames.eden
    secrets: inherit
```

`.github/workflows/deploy-android.yml`
```yaml
name: Deploy Android
on:
  workflow_dispatch:
    inputs:
      ref:
        required: false
        default: main
jobs:
  android:
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-android.yml@main
    with:
      package-name: com.biblegames.eden
      play-track: internal
    secrets: inherit
```

Secrets a configurar en `Settings → Secrets and variables → Actions` del repo `eden-choice-chronicles` (los reutilizables los exigen):

- iOS: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (si aplica), certificados/perfiles según tu `deploy-ios.yml`.
- Android: `ANDROID_KEYSTORE` (base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.

Requisitos en GitHub para que los reutilizables sean accesibles:

- Si `bgp-admin` es **privado**: en `bgp-admin` → Settings → Actions → General → "Access" → permitir acceso desde repos de la org.
- `GITHUB_PAT` (ya guardado aquí) debe ser un fine-grained PAT con permiso **Actions: Read & Write** sobre los repos de las apps.

## 6) Plan de despliegue

1. Migración BD (te paso el SQL para aprobar).
2. Backend server fns.
3. UI: listado/edición de apps + refactor pantalla de deploy + página docs.
4. Sembrar Eden vía la UI (no en migración) para que pruebes el flujo.

## Detalles técnicos relevantes

- El `GITHUB_PAT` se sigue leyendo en `process.env` dentro del handler.
- El repo y el workflow ya no se hardcodean en código: vienen de la fila `apps`.
- Validación con Zod en todas las server fns.
- Errores del API de GitHub se devuelven como `{ ok:false, error }` para mostrarlos en UI sin romper.

¿Apruebas el plan tal cual, o quieres ajustar algo (p. ej. campos extra en `apps`, otra ruta, dejar fuera la página de docs)?
