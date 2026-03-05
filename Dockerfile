FROM node:20-bookworm-slim

ARG RUST_MULE_REPO=https://github.com/DarkmodeBrewing/rust-mule.git
ARG RUST_MULE_REF=main

RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain to build rust-mule.
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /opt
RUN git clone --depth 1 --branch "${RUST_MULE_REF}" "${RUST_MULE_REPO}" /opt/rust-mule

WORKDIR /opt/rust-mule
RUN cargo fetch
RUN cargo build --release

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /data /data/logs /data/mule-doctor

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

CMD ["/entrypoint.sh"]
