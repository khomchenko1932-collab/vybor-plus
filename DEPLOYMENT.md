# Размещение API «Выбор+»

Backend упакован в стандартный Docker-контейнер и не привязан к конкретному облаку.

## Переменные окружения

- `OPENAI_API_KEY` — серверный ключ OpenAI.
- `OPENAI_MODEL` — модель, по умолчанию `gpt-4.1-mini`.
- `PORT` — порт HTTP-сервера; облачный сервис обычно задаёт его сам.
- `ALLOWED_ORIGINS` — web-адреса приложения через запятую.
- `DEMO_FALLBACK` — `true` для перехода в демо при ошибке AI.
- `RATE_LIMIT_MAX` — максимум запросов с одного IP за окно.
- `RATE_LIMIT_WINDOW_MS` — длительность окна ограничения.
- `REQUEST_TIMEOUT_MS` — таймаут обращения к AI.

## Локальная проверка Docker

```bash
docker compose up --build
```

Проверка состояния: `http://localhost:8787/health`.

## Размещение

1. Создайте Web Service из этого репозитория.
2. Выберите развёртывание из `Dockerfile`.
3. Добавьте переменные окружения из списка выше.
4. Укажите health check `/health`.
5. После выдачи HTTPS-адреса задайте его клиенту:

```env
EXPO_PUBLIC_API_URL=https://api.example.com
```

6. Пересоберите мобильное приложение. Никогда не добавляйте `OPENAI_API_KEY` в Expo-переменные.
