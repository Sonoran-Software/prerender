FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
  && ln -sf /usr/bin/chromium /usr/bin/google-chrome \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:'+ (process.env.PORT||3000) +'/health',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"

CMD ["npm", "start"]
