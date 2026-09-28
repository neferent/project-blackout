FROM node:22-slim
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm install --frozen-lockfile

WORKDIR /repo/apps/api
# tsx runs TypeScript directly: keeps the POC's build step to a single `pnpm install`.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
