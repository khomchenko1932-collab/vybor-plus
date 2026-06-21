FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.mjs providers.mjs ./

EXPOSE 8787
CMD ["node", "server.mjs"]
