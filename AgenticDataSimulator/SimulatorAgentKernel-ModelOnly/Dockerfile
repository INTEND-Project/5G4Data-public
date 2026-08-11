FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV API_SERVER_ENABLED=true
ENV API_SERVER_HOST=0.0.0.0

EXPOSE 3011

CMD ["npx", "tsx", "src/index.ts", "--debug"]
