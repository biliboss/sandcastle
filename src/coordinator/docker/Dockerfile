# coordinator/agent-base — shared image used by every coordinator dispatch.
# See ADR 0018 (shared image) + ADR 0019 (lean + setup hook).
#
# Build:
#   coordinator build-image
# Tag: coordinator/agent-base

FROM debian:bookworm-slim

ARG AGENT_UID=1000
ARG AGENT_GID=1000

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fd-find \
        git \
        gnupg \
        jq \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Node 22 via NodeSource (matches Claude Code's runtime support window).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create an `agent` user matching the host's UID/GID (overridable at build).
# If the GID already exists (e.g. macOS host's GID 20 = staff), reuse it.
RUN if ! getent group "${AGENT_GID}" >/dev/null; then \
        groupadd --gid "${AGENT_GID}" agent; \
    fi \
    && useradd --uid "${AGENT_UID}" --gid "${AGENT_GID}" --shell /bin/bash --create-home agent

USER agent
WORKDIR /home/agent

# Install Claude Code into the agent user's npm prefix so the read-only rootfs
# at dispatch time doesn't have to allow writes to /usr/local.
RUN npm config set prefix /home/agent/.npm-global \
    && npm install -g @anthropic-ai/claude-code
ENV PATH=/home/agent/.npm-global/bin:$PATH

# fdfind is the Debian-packaged binary name for fd; expose the more common `fd`.
RUN mkdir -p /home/agent/.local/bin \
    && ln -s /usr/bin/fdfind /home/agent/.local/bin/fd
ENV PATH=/home/agent/.local/bin:$PATH

WORKDIR /workspace

# Entrypoint runs the target repo's optional setup hook, then invokes Claude.
# Sandcastle's docker provider exec's commands via `sh -c`, so we keep the
# image's default CMD lightweight — it's not part of the agent invocation
# path, only useful for ad-hoc `docker run -it` debugging.
COPY --chown=agent:agent entrypoint.sh /usr/local/bin/coordinator-entrypoint
CMD ["/usr/local/bin/coordinator-entrypoint"]
