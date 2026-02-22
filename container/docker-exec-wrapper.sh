#!/bin/bash
# Claude Code executable wrapper — used as pathToClaudeCodeExecutable.
# The @anthropic-ai/claude-agent-sdk calls this script exactly as it would
# call the claude binary, forwarding all args and piping stdin/stdout.
#
# The workspace container must be running before any session starts.
# Use: docker run -d --name claude-workspace ...  (see docker-compose.yml)

CONTAINER="${CLAUDE_WORKSPACE_CONTAINER:-claude-workspace}"
exec docker exec -i "${CONTAINER}" claude "$@"
