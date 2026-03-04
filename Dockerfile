# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create a non-root user
RUN addgroup -S mule && adduser -S mule -G mule
USER mule

# Required environment variables (pass at runtime):
#   RUST_MULE_API_URL
#   RUST_MULE_LOG_PATH
#   RUST_MULE_TOKEN_PATH  (optional)
#   OPENAI_API_KEY
#   MATTERMOST_WEBHOOK_URL
#   OBSERVE_INTERVAL_MS   (optional, default 300000)

CMD ["node", "dist/index.js"]
