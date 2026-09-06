FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg libgl1 libglib2.0-0 \
    intel-media-va-driver libva2 vainfo \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir opencv-python-headless numpy \
    && useradd -m node || true

COPY package*.json tsconfig.json ./
RUN npm ci

COPY . .
RUN mkdir -p /app/data
RUN chown node:node /app/data
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
RUN npm run build

USER node
EXPOSE 3000
CMD ["npm", "start"]
