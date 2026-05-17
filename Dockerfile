FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    python3 \
    python3-pip \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Apply ws3-fca getThreadInfo patch to fix GraphQL response parsing
RUN node patch-ws3fca.js

EXPOSE 3000

ENTRYPOINT ["node", "index.js"]