---
"t3code-cli": minor
---

Restructure the public API for library consumers such as `t3-goals`.

- Add package.json subpath exports: `./layout`, `./orchestration`, `./rpc`, `./auth`, `./config`, `./connection`, `./runtime`, `./application`, `./contracts`, and `./t3tools`
- Export the full bundled `@t3tools/contracts` surface as `t3code-cli/t3tools`
- Add `resolveT3BaseDir`, `readT3LayoutFromNodeProcess`, and `T3Layout` under `t3code-cli/layout`
- Export `T3OrchestrationLayer`, `T3Orchestration`, and related types under `t3code-cli/orchestration`
- Export `RpcError` under `t3code-cli/rpc`
- Slim the default export to the application surface plus `AppLayer` and `AuthAppLayer`

**BREAKING:** The default export no longer includes `Environment`, `EnvironmentShape`, `NodeEnvironmentLive`, `SqlClientFactory`, auth/config/connection/runtime layer exports, or contract type re-exports. Use subpath imports where those surfaces remain public.
