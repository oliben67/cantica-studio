# ── Stage 1: build cantica wheel ──────────────────────────────────────────────
FROM python:3.14-slim AS cantica-wheel

WORKDIR /build/cantica-api
COPY cantica-api/pyproject.toml cantica-api/README.md ./
COPY cantica-api/src ./src
RUN pip install --no-cache-dir build && python -m build --wheel --outdir /dist


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.14-slim

LABEL org.opencontainers.image.title="Cantica Studio API"
LABEL org.opencontainers.image.description="AI Actor Studio — run actor-ai agents with MCP and Cantica prompt integration"
LABEL org.opencontainers.image.source="https://github.com/oliben67/cantica"

# Install the cantica library from the wheel built in stage 1
COPY --from=cantica-wheel /dist /dist
RUN pip install --no-cache-dir /dist/*.whl

# Pin the Copilot SDK before actor-ai so pip does not upgrade to 1.x which
# dropped ExternalServerConfig (actor-ai 0.3.x depends on 0.3.0 behaviour).
RUN pip install --no-cache-dir "github-copilot-sdk==0.3.0"

# Install actor-ai from the local wheel (includes unreleased changes).
COPY actor_ai-0.3.9-py3-none-any.whl /tmp/
RUN pip install --no-cache-dir /tmp/actor_ai-0.3.9-py3-none-any.whl

# Install cantica-secure from the local wheel (shared security package —
# satisfies the cantica-secure dependency so `pip install -e .` below resolves
# it without reaching PyPI; the [tool.uv.sources] editable path is dev-only).
COPY cantica_secure-0.1.0-py3-none-any.whl /tmp/
RUN pip install --no-cache-dir /tmp/cantica_secure-0.1.0-py3-none-any.whl

# Install studio-api and its remaining dependencies (actor-ai + cantica-secure
# already satisfied above).
WORKDIR /app
COPY cantica-studio/studio-api/pyproject.toml cantica-studio/studio-api/README.md ./
COPY cantica-studio/studio-api/src ./src
RUN pip install --no-cache-dir -e .

ENV STUDIO_WORKSPACE=/workspace
ENV STUDIO_HOST=0.0.0.0
ENV STUDIO_PORT=8043
ENV STUDIO_LOG_LEVEL=info

EXPOSE 8043

VOLUME ["/workspace"]

CMD ["studio"]
