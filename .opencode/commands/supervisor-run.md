---
description: Run one supervisor cycle
---

Execute a single cycle of the opencode-supervisor. This will:

1. Check for merged issues and close them
2. Check for parent epic issues that can be closed
3. Select the next eligible issue (or continue current)
4. Run agent turn if needed
5. Update PR status and create draft PRs when appropriate
6. Handle CI failures and review comments
7. Enable auto-merge when ready

Usage: /supervisor-run [--dry-run]

The --dry-run flag shows what would happen without making changes.
