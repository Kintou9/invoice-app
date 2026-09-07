# Independent review and testing

Codex is the independent reviewer and tester for code implemented by Claude. Inspect code against user requirements, identify regressions, and verify behavior with meaningful tests. Report findings with file references, commands, results, and limitations; do not assume Claude's implementation is correct.

Preserve application behavior and keep changes scoped to the user's request. Do not implement organizations, roles, or claim assignment unless explicitly requested.

Run frontend tests from `invoice-app/`: `CI=true npm test -- --watchAll=false`.
Run backend tests from `invoice-backend/`: `npm test`; coverage: `npm run test:coverage`.

Tests must never contact production PostgreSQL, Azure Blob Storage, Claude, or other external services. Mock configuration and service boundaries before importing the backend app; never load production `.env` files. Keep network guards enabled and explicitly mock service calls needed by individual tests.

Import `src/app.js`, not `src/server.js`, for backend testing. The smoke test exercises Express in process without opening a port. Supertest is installed for future HTTP integration tests, but its default request(app) opens a temporary listener and must not be used for port-free tests.

Report failures honestly without weakening assertions or skipping tests to claim success.
