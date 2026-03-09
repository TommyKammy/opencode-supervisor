# OpenCode Supervisor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)

A minimal GitHub issue/PR/CI supervisor for [opencode](https://opencode.ai) that automates software development workflows.

## Overview

OpenCode Supervisor orchestrates AI agents to:
- Process GitHub issues automatically
- Create and manage pull requests
- Handle CI/CD workflows
- Address code reviews
- Merge changes when ready

This is a migration of [codex-supervisor](https://github.com/TommyKammy/codex-supervisor) to work with opencode's agent orchestration system.

## Features

- 🤖 **AI Agent Integration**: Uses opencode CLI to execute development tasks
- 🔄 **State Machine**: Manages issues through a complete lifecycle (planning → implementing → PR → merge)
- 📊 **GitHub Integration**: Native integration via `gh` CLI
- 🌳 **Git Worktrees**: Isolated workspaces per issue
- 📝 **Persistent State**: JSON or SQLite backend for tracking progress
- 🔒 **Safety First**: Branch protection, review requirements, no direct main pushes
- 🏷️ **Smart Filtering**: Label-based issue selection with dependency tracking

## Requirements

- **Node.js** ≥ 22.0.0 (for `node:sqlite` support)
- **opencode** CLI ([Installation](https://opencode.ai))
- **GitHub CLI** (`gh`) authenticated
- **Git** with worktree support

## Installation

```bash
# Clone the repository
git clone https://github.com/TommyKammy/opencode-supervisor.git
cd opencode-supervisor

# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Quick Start

### 1. Configure

Create a configuration file for your repository:

```bash
cp supervisor.config.example.json myproject.config.json
```

Edit the configuration:

```json
{
  "repoPath": "/absolute/path/to/your/repo",
  "repoSlug": "OWNER/REPO",
  "defaultBranch": "main",
  "workspaceRoot": "/absolute/path/to/worktrees",
  "stateBackend": "json",
  "stateFile": "./.local/state.json",
  "issueLabel": "opencode",
  "branchPrefix": "opencode/issue-"
}
```

### 2. Run

```bash
# Check status
npm start -- status --config myproject.config.json

# Run one cycle
npm start -- run-once --config myproject.config.json

# Start continuous loop
npm start -- loop --config myproject.config.json
```

## Configuration

See `supervisor.config.example.json` for all available options:

| Option | Description | Default |
|--------|-------------|---------|
| `repoPath` | Absolute path to managed repository | (required) |
| `repoSlug` | GitHub repo in `OWNER/REPO` format | (required) |
| `defaultBranch` | Main branch name | `main` |
| `workspaceRoot` | Directory for git worktrees | (required) |
| `stateBackend` | `json` or `sqlite` | `json` |
| `stateFile` | Path to state file | `./.local/state.json` |
| `issueLabel` | Label to filter issues | `opencode` |
| `branchPrefix` | Prefix for issue branches | `opencode/issue-` |
| `agentCategoryByState` | Map states to agent categories | See example |
| `pollIntervalSeconds` | Loop interval in seconds | `120` |
| `maxAgentAttemptsPerIssue` | Max retries per issue | `30` |
| `mergeMethod` | `merge`, `squash`, or `rebase` | `squash` |

## How It Works

### State Machine

```
queued → planning → reproducing → implementing → stabilizing
                                              ↓
done ← merging ← ready_to_merge ← pr_open ← draft_pr
              ↑                    ↓
           blocked ←── addressing_review ←──┘
              ↑                    ↓
           failed ←── repairing_ci/resolving_conflict
```

### Agent Categories

| Supervisor State | opencode Category | Purpose |
|-----------------|-------------------|---------|
| `planning` | `deep` | Research and understanding |
| `reproducing` | `deep` | Investigation work |
| `implementing` | `ultrabrain` | Complex code changes |
| `stabilizing` | `unspecified-high` | General implementation |
| `repairing_ci` | `quick` | Focused fixes |
| `addressing_review` | `deep` | Review responses |

### Issue Metadata

Add metadata to your GitHub issues for dependency tracking:

```markdown
## Summary
Implement feature X

## Acceptance Criteria
- [ ] Task 1
- [ ] Task 2

Part of #10

Depends on: #5, #6

## Execution Order
1 of 3
```

## Architecture

```
GitHub Issues
    ↓
OpenCode Supervisor (this tool)
    ↓
Local state.json / SQLite
    ↓
Per-issue git worktree
    ↓
opencode CLI (subprocess)
    ↓
Draft PR / PR updates
    ↓
CI + Reviews
    ↓
Auto-merge
```

## Safety Model

- ✅ Never pushes directly to default branch
- ✅ Uses git worktrees for isolation
- ✅ Acquires locks to prevent concurrent modifications
- ✅ Requires PR reviews (configurable)
- ✅ Handles merge conflicts separately
- ✅ Validates journal handoffs from agents

## Commands

### CLI

```bash
# Show current status
node dist/index.js status --config config.json

# Run one supervisor cycle
node dist/index.js run-once --config config.json

# Run with dry-run (no changes)
node dist/index.js run-once --config config.json --dry-run

# Start continuous loop
node dist/index.js loop --config config.json
```

### Convenience Script

```bash
# Create a runner script for your project
./run-headless-cms.sh status
./run-headless-cms.sh run
./run-headless-cms.sh loop
```

## Systemd Service (Linux)

Install as a user service:

```bash
./scripts/install-systemd.sh
systemctl --user start opencode-supervisor
systemctl --user status opencode-supervisor
journalctl --user -u opencode-supervisor -f
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode (if using tsx)
npm run dev
```

## Troubleshooting

### Agent turn rejected: "no journal handoff written"

The agent must update the `## Agent Working Notes` section in the issue journal before completing. This ensures proper handoff between sessions.

### "Command timed out"

Increase `agentExecTimeoutMinutes` in your config (default: 30).

### "lock held by pid X"

Delete lock files in `.local/locks/` if a previous run crashed.

## Migration from codex-supervisor

1. Copy your existing `supervisor.config.json`
2. Replace `codexBinary` with `agentCategoryByState` mapping
3. Rename fields:
   - `codex*` → `agent*`
   - `last_codex_summary` → `last_agent_summary`
   - `codex_session_id` → `agent_session_id`
4. Update paths from `.codex-supervisor/` to `.opencode-supervisor/`

## Differences from codex-supervisor

| Feature | codex-supervisor | opencode-supervisor |
|---------|------------------|---------------------|
| Agent execution | Subprocess `codex exec` | `opencode run` CLI |
| Session management | `codex_session_id` | `agent_session_id` |
| Model selection | Model strategy | Category mapping |
| Integration | Standalone | opencode CLI |

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT License - see [LICENSE](LICENSE) file.

## Acknowledgments

- Based on [codex-supervisor](https://github.com/TommyKammy/codex-supervisor) by the same author
- Built for [opencode](https://opencode.ai) AI agent platform
