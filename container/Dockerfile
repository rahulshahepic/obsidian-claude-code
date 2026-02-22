FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl git python3 python3-pip python3-venv \
    ripgrep fd-find jq wget unzip \
    && rm -rf /var/lib/apt/lists/*

# Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# uv (fast Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Claude Code CLI — installed globally so claude is on PATH
RUN npm install -g @anthropic-ai/claude-code

# Non-root user for security; vault is mounted at /vault
RUN useradd -m -s /bin/bash claude
USER claude
WORKDIR /home/claude

VOLUME /vault
