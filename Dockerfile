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
ENV DATABASE_URL=postgresql://neondb_owner:npg_2Nmx7fBiwZEL@ep-withered-cell-ayqgw42k.c-5.us-east-2.aws.neon.tech/nibras_prod?sslmode=require

EXPOSE 3000

CMD ["node", "server.js"]
