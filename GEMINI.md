<!-- ai-context-orchestrator:generated:start -->
## AI Context Orchestrator

- Workflow preset: explore
- Roles prepared: explorer, architect
- Refresh mode: smart-refresh
- Cost profile: balanced
- Context file: .ai-context.md
- Context budget profile: gemini-balanced
- Context budget summary: treeDepth=2, entries=28, readmeLines=20, instructionLines=80, deps=10, devDeps=8, scripts=8, keyFiles=8, instructionFiles=4

### Context First
Use the generated context pack as the primary source of truth for repository structure, key files, commands, and constraints.
This run uses a bounded context budget: treeDepth=2, entries=28, readmeLines=20, instructionLines=80, deps=10, devDeps=8, scripts=8, keyFiles=8, instructionFiles=4.
Prefer direct, well-structured reasoning with grounded file evidence over speculative expansion.

### Operating Style
- Keep the workflow explicit instead of blending exploration, planning, implementation, and review together.
- Work in short iterations and reassess after each concrete finding or edit.
- Prefer stable project patterns and minimal edits over flexible abstractions.

### Task
Start by understanding the codebase, summarize key files, and wait for the next instruction before editing anything.

### Preset Priorities
- Map the relevant code paths, extension points, and reusable patterns before proposing changes.
- Keep the output descriptive and grounded in files instead of speculative solutioning.

### Completion Criteria
- Stop once the user has a clear map of the relevant surface and the likely next action.
- Do not edit code unless a later instruction explicitly converts exploration into implementation.

### Avoid
- Do not drift into implementation detail that the exploration evidence does not justify.
- Do not broaden the scan beyond the user-relevant area of the repository.

### Key files
- index.html
- server.js

### Useful commands
No package scripts detected.

### Instruction files already present
No provider-specific instruction files were detected during generation.
<!-- ai-context-orchestrator:generated:end -->
