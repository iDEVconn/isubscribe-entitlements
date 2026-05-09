FROM node:24-alpine AS builder

WORKDIR /repo

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/entitlements/package.json packages/entitlements/
COPY apps/example-nest-api/package.json apps/example-nest-api/
COPY apps/example-react/package.json apps/example-react/

RUN npm install --no-audit --no-fund

COPY packages packages
COPY apps apps

RUN npm run build --workspace @isubscribe/entitlements
RUN npm run build --workspace example-nest-api

FROM node:24-alpine AS runtime

WORKDIR /app
ARG PORT=3000
ENV NODE_ENV=production
ENV PORT=${PORT}

COPY package.json package-lock.json* ./
COPY packages/entitlements/package.json packages/entitlements/
COPY apps/example-nest-api/package.json apps/example-nest-api/

RUN npm install --no-audit --no-fund --omit=dev

COPY --from=builder /repo/packages/entitlements/dist packages/entitlements/dist
COPY --from=builder /repo/apps/example-nest-api/dist apps/example-nest-api/dist

EXPOSE ${PORT}
CMD ["node", "apps/example-nest-api/dist/main.js"]
