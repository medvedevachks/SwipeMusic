# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM node:22-alpine AS production
RUN addgroup -S swipe && adduser -S swipe -G swipe
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
USER swipe
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM production AS migrate
USER swipe
CMD ["node", "dist/migrate.js"]

FROM deps AS test
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
CMD ["npm", "test"]
