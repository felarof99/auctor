# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding guidelines

- **Use extensionless imports.** Do not use `.js` extensions in TypeScript imports. Bun resolves `.ts` files automatically.
  ```typescript
  // Correct
  import { foo } from './utils'
  import type { Bar } from '../types'

  // Wrong
  import { foo } from './utils.js'
  ```
- Write minimal code comments. Only add comments for non-obvious logic, complex algorithms, or critical warnings. Skip comments for self-explanatory code, obvious function names, and simple operations.

## File Naming Convention

Use **kebab-case** for all file and folder names:

| Type | Convention | Example |
|------|------------|---------|
| Multi-word files | kebab-case | `my-module.ts`, `git-parser.ts` |
| Single-word files | lowercase | `types.ts`, `index.ts` |
| Test files | `.test.ts` suffix | `git-parser.test.ts` |
| Folders | kebab-case | `my-feature/`, `shared-utils/` |

Classes remain PascalCase in code, but live in kebab-case files:
```typescript
// file: git-parser.ts
export class ApiClient { ... }
```

## Bun Preferences

Default to using Bun instead of Node.js:

- Use `bun <file>` instead of `node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads .env (no dotenv needed)

## Common Commands

```bash
# Linting
bun run lint                     # Check with Biome
bun run lint:fix                 # Auto-fix with Biome

# Type checking
bun run typecheck                # TypeScript build check
```

## Architecture

This is a monorepo with apps in `apps/` and shared packages in `packages/`.

## Creating Packages

When creating new packages in this monorepo:

- **Location:** Packages go in `packages/`, apps go in `apps/`
- **No index.ts:** Don't create or export an `index.ts` - it inflates the bundle with all exports
- **Separate export files:** Keep exports in individual files (e.g., `logger.ts`, `ports.ts`)
- **Import pattern:** `import { X } from "@my-package/name/logger"` - only imports what's needed

**package.json exports:** Must include both `types` and `default` for TypeScript:
```json
"exports": {
  "./constants/ports": {
    "types": "./src/constants/ports.ts",
    "default": "./src/constants/ports.ts"
  }
}
```
