# -------- Build Stage --------
FROM golang:1.22-alpine AS builder

# Enable CGO-less static build
ENV CGO_ENABLED=0

# Create working directory
WORKDIR /app

# Install git (needed for go mod if using Git dependencies)
RUN apk add --no-cache git

# Copy go mod files and download deps
COPY go.mod go.sum ./
RUN go mod download

# Copy only necessary source code
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY public/ ./public/

# Build the binary
RUN go build -o server ./cmd/server

# -------- Final Image --------
FROM alpine:latest

# Create a non-root user (optional)
RUN adduser -D appuser

# su-exec: fix volume ownership then run server as non-root
RUN apk --no-cache add ca-certificates su-exec

WORKDIR /app

# Copy binary and static assets from builder
COPY --from=builder /app/server .
COPY --from=builder /app/public ./public

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && chown -R appuser:appuser /app/public

# Expose the Fiber app port
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
