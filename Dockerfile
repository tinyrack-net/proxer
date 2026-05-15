# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/tools/package.json packages/tools/package.json
# The workspace-local proxer-tools binary points at packages/tools/src/cli.ts.
# Copy the tools source before install so pnpm can create the workspace bin link.
COPY packages/tools/src packages/tools/src
RUN pnpm install --frozen-lockfile

COPY . .

ARG TARGETARCH=amd64
RUN set -eux; \
  case "$TARGETARCH" in \
    amd64) pkg_arch=x64 ;; \
    arm64) pkg_arch=arm64 ;; \
    *) echo "Unsupported Docker target architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  pnpm --filter @tinyrack/proxer run pkg:build -- --target "node24-linux-${pkg_arch}"; \
  cp packages/cli/dist/pkg/proxer /tmp/proxer

FROM debian:bookworm-slim AS runtime

COPY --from=build --chmod=755 /tmp/proxer /usr/local/bin/proxer

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/proxer"]
CMD ["--help"]
