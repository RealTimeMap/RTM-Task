# syntax=docker/dockerfile:1.7
# ==========================================================
# Образ интерфейса RTM Task UI.
#
# Сборка:
#   docker build -t rtm-task-ui .
# ==========================================================
ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27-alpine

# ==========================================================
# Stage 1: deps — зависимости
#
# Отдельный слой: пересобирается только при правке package-lock.json,
# а не при каждом изменении исходников.
# ==========================================================
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /build

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ==========================================================
# Stage 2: builder — сборка статики
# ==========================================================
FROM deps AS builder
WORKDIR /build

COPY . .

# Адреса API зашиваются в бандл на этапе сборки. По умолчанию все
# относительные: фронт и API живут на одном домене, а auth проксируется
# через nginx (см. nginx.conf) — так браузер остаётся на одном origin
# и CORS не нужен.
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_AUTH_BASE_PATH

RUN npm run build

# ==========================================================
# Stage 3: runtime — раздача статики
# ==========================================================
FROM nginx:${NGINX_VERSION} AS runtime

RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /build/dist /usr/share/nginx/html

# Шаблон, а не готовый конфиг: образ nginx подставляет в него переменные
# окружения при старте (см. /docker-entrypoint.d/20-envsubst-on-templates.sh).
# Так адрес auth-service задаётся при запуске, а не зашивается в образ.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Адрес auth-service по умолчанию — как он зовётся в service-network.
ENV AUTH_HOST=realtime-map-backend:8001

# Подставляется только AUTH_HOST: иначе envsubst съел бы и переменные
# самого nginx ($host, $uri, $remote_addr) и конфиг сломался бы.
ENV NGINX_ENVSUBST_FILTER=AUTH_HOST

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
