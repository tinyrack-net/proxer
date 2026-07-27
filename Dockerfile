# syntax=docker/dockerfile:1

FROM dart:3.12.2-sdk AS build

WORKDIR /workspace

COPY pubspec.yaml pubspec.lock analysis_options.yaml ./
COPY packages/cli/pubspec.yaml packages/cli/pubspec.yaml
COPY packages/tools/pubspec.yaml packages/tools/pubspec.yaml
RUN dart pub get

COPY packages/cli packages/cli
RUN dart compile exe packages/cli/bin/proxer.dart -o /tmp/proxer

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chmod=755 /tmp/proxer /usr/local/bin/proxer

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/proxer"]
CMD ["--help"]
