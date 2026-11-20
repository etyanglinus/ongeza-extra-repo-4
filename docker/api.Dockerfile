# Ongeza core API (Laravel 13 / PHP 8.3) with PostgreSQL + Redis drivers.
# Build context: the Ongeza-admin repository.
FROM node:22-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY resources ./resources
RUN npm run build

FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-scripts --no-autoloader --ignore-platform-reqs

FROM php:8.3-apache-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu-dev libonig-dev libzip-dev libpq-dev unzip \
    && docker-php-ext-install -j"$(nproc)" pdo_pgsql pdo_mysql mbstring intl zip bcmath pcntl opcache \
    && pecl install redis && docker-php-ext-enable redis \
    && a2enmod rewrite headers remoteip \
    && rm -rf /var/lib/apt/lists/* /tmp/pear
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!/var/www/html/public!g' /etc/apache2/sites-available/000-default.conf \
    && printf '<Directory /var/www/html/public>\nAllowOverride All\nRequire all granted\n</Directory>\nServerTokens Prod\nServerSignature Off\n' > /etc/apache2/conf-available/ongeza.conf \
    && a2enconf ongeza \
    && printf 'opcache.enable=1\nopcache.validate_timestamps=0\nopcache.memory_consumption=192\nexpose_php=Off\n' > /usr/local/etc/php/conf.d/ongeza.ini
WORKDIR /var/www/html
COPY --from=vendor /app/vendor ./vendor
COPY . .
COPY --from=assets /build/public/build ./public/build
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative \
    && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD php -r 'exit(@file_get_contents("http://127.0.0.1/api/v1/health") === false ? 1 : 0);'
