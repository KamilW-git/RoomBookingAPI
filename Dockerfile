# Obraz API Room Booking. Budowanie: docker build -t roombooking-api .
FROM node:22.21.1-alpine

WORKDIR /app

# Domyślnie produkcyjnie: wartości-wzory z .env.example są wtedy odrzucane przez konfigurację.
# docker-compose.yml do lokalnego uruchomienia nadpisuje to wartością z .env (domyślnie development).
ENV NODE_ENV=production

# Najpierw same manifesty zależności i instalacja: ta warstwa jest budowana ponownie tylko po zmianie
# package.json / package-lock.json, a nie po każdej zmianie kodu (cache warstw).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Kod aplikacji (lista wykluczeń w .dockerignore)
COPY . .

# Aplikacja nie potrzebuje uprawnień roota
USER node

EXPOSE 3000

# Przy starcie kontenera: migracje, potem serwer. `exec` zastępuje powłokę procesem Node, więc to Node
# dostaje SIGTERM od `docker compose down/stop` i wykonuje graceful shutdown.
CMD ["sh", "-c", "node_modules/.bin/knex migrate:latest && exec node src/server.js"]
