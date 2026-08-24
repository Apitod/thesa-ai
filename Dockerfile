# ============================================================
# Stage 1: Build Go Backend Binary
# ============================================================
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install git, ca-certificates and build tools
RUN apk add --no-cache git ca-certificates tzdata

# Cache Go dependency downloads
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and embedded SQL migrations
COPY cmd ./cmd
COPY internal ./internal

# Build optimized static Linux binary (stripping debugging symbols for minimal size)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/thesa-server ./cmd/server

# ============================================================
# Stage 2: Production Minimal & Secure Image
# ============================================================
FROM alpine:3.20

WORKDIR /app

# Install CA certificates for external HTTPS/AI APIs and timezone data
RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -g 10001 -S thesagroup \
    && adduser -u 10001 -S thesa -G thesagroup

# Copy compiled binary from builder stage
COPY --from=builder /app/thesa-server /app/thesa-server

# Copy static frontend assets
COPY web ./web

# Set appropriate permissions
RUN chown -R thesa:thesagroup /app

# Run as non-root user for cloud security best practices
USER thesa

# Default environment configuration
ENV PORT=8080 \
    TZ=Asia/Jakarta

EXPOSE 8080

# Native container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-8080}/health || exit 1

# Start production server
CMD ["/app/thesa-server"]
