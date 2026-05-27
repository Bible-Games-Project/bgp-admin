
# Plan: Panel para disparar GitHub Actions

## Objetivo
Una web muy simple con un solo botón "Deploy" que dispara el workflow `deploy.yml` en `Bible-Games-Project/shared-workflows` vía la API de GitHub (`workflow_dispatch`).

## Stack y decisiones
- **Backend**: Lovable Cloud (incluye auth segura). Se habilita en el primer paso del build.
- **Auth (login fuerte)**: Email + contraseña con Lovable Cloud, más:
  - Protección contra contraseñas filtradas (HIBP) activada.
  - Signups deshabilitados desde el dashboard tras crear tu cuenta, así nadie más puede registrarse.
  - Acceso restringido por una tabla `admins` (user_id) con RLS; sólo tu user_id estará en ella. Esto evita que aunque alguien lograra crear una cuenta, pueda usar el botón.
  - Opción de añadir Google como segundo método más adelante si lo quieres.
- **Llamada a GitHub**: server function de TanStack Start (`createServerFn`) protegida por sesión + check de admin. El `GITHUB_PAT` se guarda como secret en Lovable Cloud y nunca toca el cliente.
- **Endpoint GitHub**: `POST /repos/Bible-Games-Project/shared-workflows/actions/workflows/deploy.yml/dispatches` con body `{ "ref": "main" }`.

## UI (1 sola pantalla útil)
- `/login` — formulario email + password.
- `/` (protegida, layout `_authenticated`):
  - Card centrada: título "Bible Games — Deploys".
  - Bloque para el workflow `deploy.yml`:
    - Selector opcional de branch (default `main`).
    - Botón grande **Deploy**.
    - Toast de éxito/error + link al run en github.com/.../actions tras disparar.
  - Botón logout en la esquina.

Diseñado para añadir más workflows/repos después simplemente duplicando la card.

## Pasos de implementación
1. Habilitar Lovable Cloud.
2. Crear tabla `admins (user_id uuid pk references auth.users)` + RLS (sólo el propio user ve su fila) + grants.
3. Activar HIBP en auth settings.
4. Pedirte el `GITHUB_PAT` (fine-grained, scope `actions:write` sobre `shared-workflows`) y guardarlo como secret.
5. Rutas: `__root`, `_authenticated`, `_authenticated/index` (panel), `login`.
6. Server function `triggerDeploy({ ref })`:
   - Verifica sesión (`requireSupabaseAuth`) y que `userId` esté en `admins`.
   - Llama a la API de GitHub con el PAT.
   - Devuelve `{ ok, runUrl? , error? }`.
7. UI con shadcn + toast.
8. Tras desplegar, te indico cómo:
   - Crear tu cuenta (única vez).
   - Insertar tu fila en `admins`.
   - Desactivar signups en el dashboard.

## Notas técnicas
- `workflow_dispatch` requiere que el workflow tenga `on: workflow_dispatch:` en el yml — tú ya lo añadirás.
- La API responde `204 No Content` sin devolver el run_id; obtenemos el último run con `GET /repos/.../actions/workflows/deploy.yml/runs?per_page=1` para enseñar el link.
- PAT recomendado: fine-grained, sólo este repo, permiso "Actions: Read and write".
