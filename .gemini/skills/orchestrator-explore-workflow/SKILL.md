---
name: orchestrator-explore-workflow
description: Understand the codebase before changing anything
---

# Workflow Skill

Start by understanding the codebase, summarize key files, and wait for the next instruction before editing anything.

When to use this skill:
- Use it when the request needs the explore workflow.
- Keep the role chain explicit instead of blending exploration, implementation, review, and testing together.

Execution loop:
- Read the generated context pack and relevant files first.
- Work in short iterations with concrete evidence from files or command output.
- Stop after a role-specific result and hand off if another role is more appropriate.

Preset priorities:
- Map the relevant code paths, extension points, and reusable patterns before proposing changes.
- Keep the output descriptive and grounded in files instead of speculative solutioning.

Completion criteria:
- Stop once the user has a clear map of the relevant surface and the likely next action.
- Do not edit code unless a later instruction explicitly converts exploration into implementation.

Avoid:
- Do not drift into implementation detail that the exploration evidence does not justify.
- Do not broaden the scan beyond the user-relevant area of the repository.

Roles prepared for this workflow:
- explorer
- architect

Workflow signals:
- index.html
- server.js

Read .ai-context.md first.
Useful commands: none.
