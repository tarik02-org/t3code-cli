---
"t3code-cli": patch
---

Treat ready sessions with stale running turn snapshots as complete when an assistant response is present, fixing thread callbacks that were registered before source thread completion.
