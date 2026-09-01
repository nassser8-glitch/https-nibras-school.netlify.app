FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js seed.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV WEBROOT=public
ENV TRUST_PROXY=1
ENV FORCE_HTTPS=1
ENV DATABASE_URL=postgresql://neondb_owner:npg_PJsqHUY9c5Zz@ep-bitter-rice-aerhp71v.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require

EXPOSE 3000

CMD ["node", "server.js"]
