---
"t3code-cli": patch
---

Restructure README with improved navigation and add self-identity guidance to skill.

- README now has clearer sections: Quick Start, Authentication, Project Management, Models, Thread Management
- Skill updated with guidance to use `t3cli thread show` to check identity before spawning threads
- Agents should prefer same provider and model family when starting new threads
