FROM node:22-slim
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm install --frozen-lockfile

WORKDIR /repo/apps/web
CMD ["pnpm", "dev", "--host"]
