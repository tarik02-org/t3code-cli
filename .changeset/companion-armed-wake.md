---
"t3code-cli": minor
---

companion: waking subscriptions are one-shot; a wake disarms the subscription until `arm` or a repeat `subscribe` re-arms it, while failures and questions always wake
