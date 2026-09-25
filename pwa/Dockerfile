# Build from the repo root: docker build -f pwa/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /build
COPY pwa/package.json pwa/package-lock.json ./
RUN npm ci
COPY pwa .
# The commit being built, shown in the app so a deployment can be checked.
ARG BUILD_ID=unknown
ENV BUILD_ID=$BUILD_ID
RUN npm run build

FROM nginx:1.30-alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
# Included by every location that sets a header of its own (nginx drops
# inherited headers otherwise).
COPY infra/nginx/security-headers.conf /etc/nginx/conf.d/security-headers.conf
# Renders TRUSTED_PROXY_CIDRS into the geo include nginx.conf reads; the
# image's entrypoint runs everything in this directory before nginx starts.
COPY infra/nginx/20-trusted-proxies.sh /docker-entrypoint.d/20-trusted-proxies.sh
RUN chmod +x /docker-entrypoint.d/20-trusted-proxies.sh
EXPOSE 80
