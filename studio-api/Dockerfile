# ── Stage 1: build cantica wheel ──────────────────────────────────────────────
FROM python:3.14-slim AS cantica-wheel

WORKDIR /build/cantica-api
COPY cantica-api/pyproject.toml cantica-api/README.md ./
COPY cantica-api/src ./src
RUN pip install --no-cache-dir build && python -m build --wheel --outdir /dist


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.14-slim

LABEL org.opencontainers.image.title="Cantica Studio API"
LABEL org.opencontainers.image.description="Lightweight local prompt server for the Cantica Studio VSCode extension"
LABEL org.opencontainers.image.source="https://github.com/oliben67/cantica"

# Install the cantica library from the wheel built in stage 1
COPY --from=cantica-wheel /dist /dist
RUN pip install --no-cache-dir /dist/*.whl

# Install studio-api
WORKDIR /app
COPY cantica-studio/studio-api/pyproject.toml ./
COPY cantica-studio/studio-api/src ./src
RUN pip install --no-cache-dir -e .

ENV CANTICA_HOME=/cantica-home
ENV CANTICA_HOST=0.0.0.0
ENV CANTICA_PORT=8043

EXPOSE 8043

VOLUME ["/cantica-home"]

CMD ["cantica-studio"]
