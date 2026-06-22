# ── Etapa 1: Compilar el Widget (React) ──
FROM node:20-alpine AS widget-builder
WORKDIR /app/widget
COPY widget/package*.json ./
RUN npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm install
COPY widget/ ./
RUN npm run build

# ── Etapa 2: Compilar el Backend (NestJS) ──
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY package*.json tsconfig*.json tsconfig.build.json nest-cli.json ./
RUN npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm install
COPY prisma.config.ts ./
COPY prisma/ ./prisma/
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
COPY src/ ./src/
RUN mkdir -p public
COPY --from=widget-builder /app/widget/dist/widget.js ./public/widget.js
RUN npm run build

# ── Etapa 3: Entorno de Ejecución Final de Producción ──
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm install --omit=dev
COPY prisma.config.ts ./
COPY prisma/ ./prisma/
COPY --from=backend-builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=backend-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/public ./public
EXPOSE 3000
CMD ["node", "dist/src/main.js"]