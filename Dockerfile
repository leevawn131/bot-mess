FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    tar \
    unzip \
    python3 \
    python3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Apply ws3-fca getThreadInfo patch to fix GraphQL response parsing
RUN node patch-ws3fca.js

EXPOSE 3000

ENTRYPOINT ["node", "index.js"]