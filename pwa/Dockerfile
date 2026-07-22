# Build from the repo root: docker build -f pwa/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /build
COPY pwa/package.json pwa/package-lock.json ./
RUN npm ci
COPY pwa .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
