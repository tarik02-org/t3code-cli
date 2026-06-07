---
"t3code-cli": patch
---

Add a public T3 Code connection provider API that composes separate origin and auth values. The connection-native RPC path re-reads the provider on websocket open/reopen, while local origin resolution and local token issuance are separate services.
