FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# star-week.js is the server-side logic required by server.js via
# require('./star-week'). Dropping it from this line makes the server fail
# to boot on Render, so keep it listed here.
COPY server.js db.js seed.js star-week.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV WEBROOT=public
ENV TRUST_PROXY=1
ENV FORCE_HTTPS=1

EXPOSE 3000

CMD ["node", "server.js"]
