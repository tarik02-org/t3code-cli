---
"t3code-cli": minor
---

make t3cli usable as a library: `makeT3CodeClient` builds a per-environment client in the caller's scope, `t3code-cli/contracts` re-exports all upstream contracts, `t3code-cli/node` exports `T3CodeNodePlatformLayer`, more rpc and connection services are exported, and Effect is a caret range so hosts on the same Effect dedupe it
