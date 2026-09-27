# MinIO source image

This image builds the official MinIO community source release instead of pulling the removed public `minio/minio` container. Anonymous authenticated manifest requests for the previously configured `RELEASE.2025-09-07T16-13-09Z` image returned `401 UNAUTHORIZED` from both Quay and Docker Hub when verified on 2026-09-28. Switching registries does not restore that image.

MinIO's [latest official release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z) provides source build instructions and includes a session-policy security fix. The [community repository](https://github.com/minio/minio) is now archived and its README describes source-only distribution. This recipe uses that final tagged release; it does not imply ongoing upstream maintenance.

## Provenance

| Input | Pinned value |
| --- | --- |
| Official release | `RELEASE.2025-10-15T17-29-55Z` |
| Source commit | `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` |
| Source archive | [Official GitHub archive](https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a) |
| Archive SHA-256 | `45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841` |
| Go builder | Official `golang:1.24.13-alpine3.22`, image-index digest pinned in the Dockerfile |
| Runtime | Official `alpine:3.22`, image-index digest pinned in the Dockerfile |
| Local image tag | `hellotest/minio:RELEASE.2025-10-15T17-29-55Z` |

The source hash is checked before extraction. Go modules use the release's `go.mod` and `go.sum`, followed by `go mod verify`. The upstream module declares Go 1.24 with toolchain 1.24.8; the pinned builder supplies 1.24.13 without downloading another toolchain. The binary carries the release timestamp, tag and source commit through the same linker variables used by upstream's build script. `LICENSE` and `CREDITS` are included under `/licenses`.

The upstream Dockerfile starts from `minio/minio:latest`, so using it directly would reproduce the unavailable-image failure. This Dockerfile compiles with `CGO_ENABLED=0` and supports Linux AMD64 and ARM64 using Docker's target architecture arguments. Alpine packages are resolved at build time; the pinned source and base digests do not make all package inputs byte-for-byte reproducible.

## Build and inspect

From the repository root:

```sh
docker build -t hellotest/minio:RELEASE.2025-10-15T17-29-55Z ops/minio
docker run --rm hellotest/minio:RELEASE.2025-10-15T17-29-55Z --version
```

The first build downloads the source and Go dependencies and may take several minutes. Later builds can reuse Docker's cache. A multi-platform publication can use `docker buildx build --platform linux/amd64,linux/arm64`; choose a registry you control and publish only when intended.

The image retains the official shell entrypoint, so existing Compose `command: server /data --console-address ":9001"` works. It includes curl, trusted CA certificates and timezone data; the existing `/minio/health/ready` probe remains valid. No startup script initializes, clears, copies or changes ownership of `/data`. Existing named volumes and MinIO root credential environment variables remain the responsibility of the calling Compose configuration. Replacing an image does not require removing any volume.

Validated on 2026-09-28 with a Linux ARM64 build: release/commit output, HTTP readiness, the in-container curl probe, and the application's MinIO SDK bucket creation, object upload/stat/download and deletion. The smoke server used temporary in-memory storage and was removed afterward; application volumes were not mounted. Cached normal and offline preparation and Compose pull reuse also passed. AMD64 source/base availability was verified, but an AMD64 runtime smoke was not performed.
