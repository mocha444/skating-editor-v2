# Stage 1: Dependencies
FROM node:24-alpine AS deps
RUN apk add --no-cache python3 py3-pip ffmpeg vips-dev sqlite-libs
RUN pip3 install --break-system-packages opencv-python-headless numpy 2>/dev/null || true
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build
FROM node:24-alpine AS builder
RUN apk add --no-cache python3 py3-pip ffmpeg vips-dev
RUN pip3 install --break-system-packages opencv-python-headless numpy 2>/dev/null || true
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Runtime
FROM node:24-alpine AS runner
RUN apk add --no-cache python3 py3-pip ffmpeg vips sqlite-libs
RUN pip3 install --break-system-packages opencv-python-headless numpy 2>/dev/null || true
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY scripts/ ./scripts/
COPY docker/init-db.sql ./
RUN mkdir -p public/uploads public/results public/uploads/progress
EXPOSE 3000
CMD ["node", "server.js"]
