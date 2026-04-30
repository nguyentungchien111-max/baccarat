FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
