# Domain Docs

How engineering skills consume this repository's domain documentation.

## Before exploring, read these

- Root `CONTEXT.md` for the domain glossary and project context.
- Relevant decisions under `docs/adr/`.

If these files do not exist, proceed silently. Do not suggest creating them upfront. `/domain-modeling`, reached through `/grill-with-docs` or `/improve-codebase-architecture`, creates them lazily as terms and decisions are resolved.

## File structure

This repository uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-<decision-slug>.md
└── src/
```

## Use the glossary's vocabulary

Use the domain terms defined in `CONTEXT.md` in issues, designs, hypotheses and tests. Avoid synonyms the glossary explicitly rejects. If a needed concept is missing, reconsider the term or note the gap for `/domain-modeling`.

## Flag ADR conflicts

Explicitly surface any proposal that contradicts an existing ADR rather than silently overriding it. Identify the ADR and explain why reopening the decision is warranted.
