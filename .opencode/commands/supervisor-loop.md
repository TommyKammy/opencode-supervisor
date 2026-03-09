---
description: Start continuous supervisor loop
---

Start the opencode-supervisor in continuous loop mode. The supervisor will:

- Poll for new issues every configured interval (default: 120 seconds)
- Process issues automatically
- Handle retries for timeouts and verification failures
- Manage PR lifecycle from draft to merge
- Clean up completed worktrees

Usage: /supervisor-loop

**Note:** This command runs indefinitely. Use Ctrl+C to stop.

**Recommended workflow:**
1. Start the loop in a terminal: `npm start -- loop`
2. Or run as a service: `./scripts/install-systemd.sh`
