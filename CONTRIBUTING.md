# Contributing to GRES

Thank you for helping improve **GRES (GRES Restaurant Management System)**!

## Development Workflow

1. Ensure **Node.js `>= 22.5.0`** is installed.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run syntax checks and end-to-end tests before submitting changes:
   ```bash
   node --check server.js
   npm test
   ```

## Guidelines

- Keep all billing, GST, discount, and stock calculations server-authoritative (`src/billing.js`, `src/routes.js`).
- Preserve strict `restaurant_id` and `branch_id` multi-tenant isolation on all API queries and WebSocket events.
- Do not commit local database files (`data/*.db*`), `node_modules/`, or `.env` files.
- Add or update regression tests in `tests/e2e.js` for bug fixes or new endpoints.
