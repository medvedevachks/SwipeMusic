# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/playwright:v1.56.1-jammy
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY playwright.config.ts ./
COPY tests ./tests
ENV APP_ORIGIN=http://frontend:5173
CMD ["npx", "playwright", "test"]
