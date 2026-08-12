FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js seed.js ./
COPY public-build ./public-build

ENV NODE_ENV=production
ENV PORT=3000
ENV WEBROOT=public-build
ENV TRUST_PROXY=1
ENV FORCE_HTTPS=1

EXPOSE 3000

CMD ["node", "server.js"]
