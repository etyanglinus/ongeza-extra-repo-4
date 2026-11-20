# Ongeza app (Flutter web build), served as static files. Build context: the Ongeza-Mobile-App repository.
FROM ghcr.io/cirruslabs/flutter:stable AS build
ARG IDENTITY_BASE_URL
ARG AI_BASE_URL
ARG TENANT=ongeza
WORKDIR /app
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get
COPY . .
RUN flutter build web --release --base-href /app/ \
      --dart-define=IDENTITY_BASE_URL=${IDENTITY_BASE_URL} \
      --dart-define=AI_BASE_URL=${AI_BASE_URL} \
      --dart-define=TENANT=${TENANT}

FROM nginx:1.27-alpine
COPY --from=build /app/build/web /usr/share/nginx/html/app
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location /app/ { try_files $uri $uri/ /app/index.html; }\n  location = /healthz { return 200 "ok"; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
