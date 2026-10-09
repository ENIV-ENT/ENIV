FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p backend/uploads && chown node:node backend/uploads
USER node
CMD ["node", "server.js"]
