# Community MinIO no longer publishes public container images. Build the official
# release source; never depend on the unavailable minio/minio base image.
FROM --platform=$BUILDPLATFORM golang:1.24.13-alpine3.22@sha256:3641e0d9b931dc4f2f185dcd669c4679670e9277c8166a838ddb98a2d4389cb5 AS build

ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /src
RUN apk add --no-cache ca-certificates curl

# RELEASE.2025-10-15T17-29-55Z, resolved through the official GitHub tag API.
# Verify the immutable archive before extracting or compiling any source.
RUN curl --fail --show-error --location --retry 3 \
      https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
      --output /tmp/minio-source.tar.gz \
    && echo '45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841  /tmp/minio-source.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/minio-source.tar.gz --strip-components=1 -C /src \
    && rm /tmp/minio-source.tar.gz

RUN go mod download && go mod verify

ARG TARGETOS
ARG TARGETARCH
RUN test "$TARGETOS" = linux \
    && case "$TARGETARCH" in amd64|arm64) ;; *) echo 'Supported targets: linux/amd64 and linux/arm64' >&2; exit 1 ;; esac \
    && GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -tags kqueue -trimpath \
      -ldflags='-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z -X github.com/minio/minio/cmd.CopyrightYear=2025 -X github.com/minio/minio/cmd.CommitID=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a -X github.com/minio/minio/cmd.ShortCommitID=9e49d5e7a648' \
      -o /out/minio .

FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

# curl supports the existing Compose readiness probe. coreutils retains the
# upstream entrypoint's optional chroot --userspec behavior.
RUN apk add --no-cache ca-certificates curl tzdata coreutils
COPY --from=build /out/minio /usr/bin/minio
COPY --from=build /src/dockerscripts/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
COPY --from=build /src/LICENSE /src/CREDITS /licenses/
RUN chmod 755 /usr/bin/minio /usr/bin/docker-entrypoint.sh

LABEL org.opencontainers.image.title="HelloTest MinIO source build" \
      org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.version="RELEASE.2025-10-15T17-29-55Z" \
      org.opencontainers.image.revision="9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]
