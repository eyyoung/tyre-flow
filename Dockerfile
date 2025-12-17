# =====================================
# Stage 1: Dependencies
# =====================================
FROM node:20-slim AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# =====================================
# Stage 2: Builder
# =====================================
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# =====================================
# Stage 3: Runner
# =====================================
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install LibreOffice for Word to PDF conversion
# fonts-liberation: Microsoft font alternatives (Arial -> Liberation Sans, etc.)
# fonts-wqy-*: Chinese fonts
RUN rm -rf /var/lib/apt/lists/* \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing \
    libreoffice-writer \
    libreoffice-calc \
    fonts-liberation \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs
# 创建用户时指定 home 目录，并确保目录存在
RUN adduser --system --uid 1001 --home /home/nextjs nextjs

# 创建 LibreOffice 运行时所需的目录
RUN mkdir -p /home/nextjs/.cache/dconf \
    && mkdir -p /home/nextjs/.config/libreoffice \
    && chown -R nextjs:nodejs /home/nextjs

# 设置环境变量，确保 LibreOffice 能正确运行
ENV HOME=/home/nextjs
ENV XDG_CACHE_HOME=/home/nextjs/.cache
ENV XDG_CONFIG_HOME=/home/nextjs/.config

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy node_modules for prisma (pre-generated with correct binary targets)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

