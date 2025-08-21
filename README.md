# Sales Engineer Toolkit

## 📜 Scripts Reference

### Development

- **`dev:ratio`** – Runs the dev script for the `@qawolf/ratio-estimator` package using its own nodemon watcher.
- **`start:ratio`** – Runs the start script for the `@qawolf/ratio-estimator` package without watch mode.

### Formatting

- **`format`** – Formats all files in the repo with Prettier, fixing style issues automatically.
- **`format:check`** – Checks file formatting without modifying files (useful for CI).

### Linting

- **`lint`** – Runs ESLint across the entire monorepo to find code issues.
- **`lint:fix`** – Runs ESLint and automatically fixes fixable issues.

### Git Hooks

- **`prepare`** – Installs Husky Git hooks. Runs automatically after `npm install`.

---

## 🧹 Pre-Commit Automation

This repo uses **Husky** + **lint-staged** to keep code clean before it’s committed:

- **Prettier** runs on staged JS, JSON, and Markdown files.
- **ESLint** runs on staged JavaScript files with `--fix` enabled.

You don’t need to run these manually—commits will be blocked if code isn’t properly formatted or linted.

---

## 🛠 How to Use

```bash
# Run ratio-estimator package in dev mode
npm run dev:ratio

# Run ratio-estimator package in start mode
npm run start:ratio

# Format everything
npm run format

# Check formatting only
npm run format:check

# Lint the whole repo
npm run lint

# Lint and auto-fix
npm run lint:fix
```
