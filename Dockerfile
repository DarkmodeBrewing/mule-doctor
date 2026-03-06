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
    && git remote remove origin

WORKDIR /opt/rust-mule
RUN cargo fetch
RUN cargo build --release

FROM node:20-bookworm-slim AS app-builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-bookworm-slim AS runner

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY --from=app-builder /app/dist ./dist
COPY --from=rust-builder /opt/rust-mule /opt/rust-mule
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN groupadd --system mule \
    && useradd --system --gid mule --home-dir /app --shell /usr/sbin/nologin mule \
    && mkdir -p /data /data/logs /data/mule-doctor \
    && chown -R mule:mule /data

ENV NODE_ENV=production
ENV RUST_MULE_API_URL=http://127.0.0.1:17835
ENV RUST_MULE_TOKEN_PATH=/data/token
ENV RUST_MULE_LOG_PATH=/data/logs/rust-mule.log
ENV RUST_MULE_SOURCE_PATH=/opt/rust-mule
ENV MULE_DOCTOR_DATA_DIR=/data/mule-doctor
ENV MULE_DOCTOR_STATE_PATH=/data/mule-doctor/state.json
ENV MULE_DOCTOR_HISTORY_PATH=/data/mule-doctor/history.json
ENV MULE_DOCTOR_LLM_LOG_DIR=/data/mule-doctor

VOLUME ["/data"]
USER mule

CMD ["/entrypoint.sh"]
