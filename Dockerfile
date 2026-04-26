FROM node:20-bookworm-slim

WORKDIR /app

# ffmpeg is needed by media commands (mp3/say) for audio conversion.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "index.js"]
