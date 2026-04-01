FROM rust:1-bookworm AS rust-builder

ARG RUST_MULE_REPO=https://github.com/DarkmodeBrewing/rust-mule.git
ARG RUST_MULE_REF=main

RUN apt-get update && apt-get install -y \
    git \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone "${RUST_MULE_REPO}" /opt/rust-mule \
    && cd /opt/rust-mule \
    && git checkout "${RUST_MULE_REF}" \
    && printf 'Resolved rust-mule ref: %s\n' "$(git rev-parse HEAD)" \
    && git remote remove origin

WORKDIR /opt/rust-mule
RUN cargo fetch
RUN cargo build --release

FROM node:20-bookworm-slim AS app-builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

FROM node:20-bookworm-slim AS runner

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=app-builder /app/dist ./dist
COPY scripts/container-healthcheck.sh /app/scripts/container-healthcheck.sh
COPY --from=rust-builder /opt/rust-mule /opt/rust-mule
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /app/scripts/container-healthcheck.sh

RUN mkdir -p /data /data/logs /data/mule-doctor \
    && chown -R node:node /data

ENV NODE_ENV=production
ENV RUST_MULE_API_URL=http://127.0.0.1:17835
ENV RUST_MULE_TOKEN_PATH=/data/token
ENV RUST_MULE_LOG_PATH=/data/logs/rust-mule.log
ENV RUST_MULE_SOURCE_PATH=/opt/rust-mule
ENV MULE_DOCTOR_DATA_DIR=/data/mule-doctor
ENV MULE_DOCTOR_STATE_PATH=/data/mule-doctor/state.json
ENV MULE_DOCTOR_HISTORY_PATH=/data/mule-doctor/history.json
ENV MULE_DOCTOR_LLM_LOG_DIR=/data/mule-doctor
ENV MULE_DOCTOR_UI_ENABLED=false
ENV MULE_DOCTOR_UI_HOST=127.0.0.1
ENV MULE_DOCTOR_UI_PORT=18080

VOLUME ["/data"]
EXPOSE 17835 18080
HEALTHCHECK --interval=30s --timeout=10s --start-period=150s --retries=3 CMD ["/app/scripts/container-healthcheck.sh"]
USER node

CMD ["/entrypoint.sh"]
