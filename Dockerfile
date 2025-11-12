FROM node:18-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY turbo.json ./
RUN npm ci

# Copy source code
COPY . .

# Build all packages
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

COPY --from=base /app/package*.json ./
COPY --from=base /app/turbo.json ./
RUN npm ci --only=production

COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "services/api-gateway/dist/index.js"]
