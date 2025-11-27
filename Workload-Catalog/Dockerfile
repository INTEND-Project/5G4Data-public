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

# Install CA certs for HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary and static assets from builder
COPY --from=builder /app/server .
COPY --from=builder /app/public ./public

# Use non-root user
USER appuser

# Expose the Fiber app port
EXPOSE 3000

# Set the default command
CMD ["./server"]
