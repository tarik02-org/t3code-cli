# t3code-cli

## 0.6.0

### Minor Changes

- de470d8: Restructure the public API for library consumers such as `t3-goals`.

  - Add package.json subpath exports: `./layout`, `./orchestration`, `./rpc`, `./auth`, `./config`, `./connection`, `./runtime`, `./application`, `./contracts`, and `./t3tools`
  - Export the full bundled `@t3tools/contracts` surface as `t3code-cli/t3tools`
  - Add `resolveT3BaseDir`, `readT3LayoutFromNodeProcess`, and `T3Layout` under `t3code-cli/layout`
  - Export `T3OrchestrationLayer`, `T3Orchestration`, and related types under `t3code-cli/orchestration`
  - Export `RpcError` under `t3code-cli/rpc`
  - Slim the default export to the application surface plus `AppLayer` and `AuthAppLayer`

  **BREAKING:** The default export no longer includes `Environment`, `EnvironmentShape`, `NodeEnvironmentLive`, `SqlClientFactory`, auth/config/connection/runtime layer exports, or contract type re-exports. Use subpath imports where those surfaces remain public.

## 0.5.1

### Patch Changes

- 7cbfcdf: Add a public T3 Code connection provider API that composes separate origin and auth values. The connection-native RPC path re-reads the provider on websocket open/reopen, while local origin resolution and local token issuance are separate services.

## 0.5.0

### Minor Changes

- 8d1d06e: Export local and pairing auth services, supporting environment/config/sqlite layers, and split token issuance from config writes for programmatic auth flows.

## 0.4.0

### Minor Changes

- f882df4: replace local auth's t3 cli dependency with direct t3code database session issuance, update pairing to exchange credentials through oauth token exchange, and align websocket auth with the current upstream ticket contract

## 0.3.0

### Minor Changes

- 37ec214: Stop publishing package types that resolve to source files and workspace-only contracts.

## 0.2.0

### Minor Changes

- 3c31a60: Support t3code servers mounted under custom base URLs.

## 0.1.3

### Patch Changes

- f61d6d1: - Move internal schema definitions to upstream t3code schema modules for shared contract alignment.

## 0.1.2

### Patch Changes

- 0e5f0e9: Create GitHub releases and tags when publishing packages.

## 0.1.1

### Patch Changes

- ab979c0: Rename npm package

## 0.1.0

### Minor Changes

- f37522b: Initial release.
