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
# قاعدة البيانات تُمرَّر سراً من إعدادات Render (Environment → Secret File/Value: DATABASE_URL)
# ولا تُضمّن في الملف أبداً — إن لم تُضبط، سيستخدم server.js اتصالاً افتراضياً محلياً ويفشل.
# DATABASE_URL placeholder removed (previously contained a live Neon password).

EXPOSE 3000

CMD ["node", "server.js"]
