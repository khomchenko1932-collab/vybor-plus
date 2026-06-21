import http from "node:http";
import crypto from "node:crypto";
import OpenAI from "openai";
import { enrichRecommendation } from "./providers.mjs";

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 100000);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 30);
const demoFallback = process.env.DEMO_FALLBACK !== "false";
const configuredOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = new Set((configuredOrigins || "").split(",").map(value => value.trim()).filter(Boolean));
const localOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?$/;
const isOriginAllowed = origin => !origin || allowedOrigins.has(origin) || (!configuredOrigins && localOriginPattern.test(origin));
const openaiMaxRetries = Number(process.env.OPENAI_MAX_RETRIES ?? (demoFallback ? 0 : 2));
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: requestTimeoutMs, maxRetries: openaiMaxRetries }) : null;
const rateBuckets = new Map();

const getClientIp = req => (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
const checkRateLimit = req => {
  const now = Date.now();
  const key = getClientIp(req);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return { allowed: true, remaining: rateLimitMax - 1, resetAt: now + rateLimitWindowMs };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= rateLimitMax, remaining: Math.max(0, rateLimitMax - bucket.count), resetAt: bucket.resetAt };
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, rateLimitWindowMs).unref();

const questionSchema = {
  type: "object", additionalProperties: false,
  properties: { questions: { type: "array", minItems: 2, maxItems: 4, items: {
    type: "object", additionalProperties: false,
    properties: { id: { type: "string" }, label: { type: "string" }, placeholder: { type: "string" }, required: { type: "boolean" } },
    required: ["id", "label", "placeholder", "required"]
  }}}, required: ["questions"]
};
const resultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    best: { $ref: "#/$defs/card" }, budget: { $ref: "#/$defs/card" }, premium: { $ref: "#/$defs/card" },
    avoid: { $ref: "#/$defs/card" }, finalAdvice: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    freshnessNote: { type: "string" }, updatedAt: { type: "string" }
  },
  required: ["best", "budget", "premium", "avoid", "finalAdvice", "confidence", "freshnessNote", "updatedAt"],
  $defs: { card: { type: "object", additionalProperties: false, properties: {
    title: { type: "string" }, description: { type: "string" }, reasons: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 }
    , searchQuery: { type: "string" }
  }, required: ["title", "description", "reasons", "searchQuery"] }}
};
const detectCategory = query => {
  const text = query.toLowerCase();
  if (/подар|сюрприз|день рожд|юбилей/.test(text)) return "gift";
  if (/мест|ресторан|кафе|отел|куда|поезд|отдых|город/.test(text)) return "place";
  if (/услуг|мастер|ремонт|репетитор|врач|дизайн|подрядчик/.test(text)) return "service";
  if (/решени|переезд|увольн|отношени|выбрать между|стоит ли/.test(text)) return "decision";
  return "product";
};

const categoryQuestions = {
  product: [
    { id: "budget", label: "Какой максимальный бюджет?", placeholder: "Например, 500", required: true },
    { id: "priority", label: "Что важнее всего?", placeholder: "Качество, камера, автономность, дизайн…", required: true },
    { id: "context", label: "Как будете использовать?", placeholder: "Дом, работа, поездки…", required: true },
    { id: "limits", label: "Есть обязательные требования?", placeholder: "Бренд, размер, функция…", required: false },
  ],
  gift: [
    { id: "recipient", label: "Для кого подарок?", placeholder: "Возраст и кем вам приходится", required: true },
    { id: "occasion", label: "Какой повод?", placeholder: "День рождения, благодарность…", required: true },
    { id: "interests", label: "Чем человек увлекается?", placeholder: "Хобби, стиль, интересы", required: true },
    { id: "budget", label: "Какой бюджет?", placeholder: "Сумма в выбранной валюте", required: true },
  ],
  place: [
    { id: "location", label: "В каком городе или районе?", placeholder: "Город, район или рядом со мной", required: true },
    { id: "date", label: "Когда планируете?", placeholder: "Дата, время или сезон", required: true },
    { id: "atmosphere", label: "Какая атмосфера нужна?", placeholder: "Спокойно, романтично, с детьми…", required: true },
    { id: "budget", label: "Какой бюджет?", placeholder: "На человека или за весь визит", required: false },
  ],
  service: [
    { id: "location", label: "Где нужна услуга?", placeholder: "Город или район", required: true },
    { id: "task", label: "Опишите задачу", placeholder: "Что именно нужно сделать", required: true },
    { id: "deadline", label: "Какой срок?", placeholder: "Срочно, на неделе, конкретная дата", required: true },
    { id: "priority", label: "Что важнее при выборе?", placeholder: "Цена, опыт, гарантия, скорость…", required: true },
  ],
  decision: [
    { id: "options", label: "Между какими вариантами выбираете?", placeholder: "Кратко перечислите варианты", required: true },
    { id: "priority", label: "Какой результат для вас важнее?", placeholder: "Деньги, спокойствие, рост, время…", required: true },
    { id: "risks", label: "Чего больше всего опасаетесь?", placeholder: "Главный риск или сомнение", required: true },
    { id: "deadline", label: "Когда нужно принять решение?", placeholder: "Срок или дата", required: false },
  ],
};

const demoQuestions = query => {
  const category = detectCategory(query);
  return { questions: categoryQuestions[category], category, demo: true };
};
const demoResult = ({ query, currency, answers }) => {
  const priority = answers?.priority || "качество и удобство";
  const context = answers?.context || "повседневное использование";
  const refinement = answers?.refinement;
  const refinementNote = refinement ? ` Уточнение пользователя: «${refinement}».` : "";
  const isPhone = /телефон|смартфон/i.test(query);
  const search = {
    best: isPhone ? `смартфон средний сегмент ${priority}` : `${query} ${priority}`,
    budget: isPhone ? `бюджетный смартфон ${priority}` : `бюджетный ${query}`,
    premium: isPhone ? `премиальный смартфон ${priority}` : `премиум ${query}`,
    avoid: query,
  };
  return {
    best: { title: refinement ? "Обновлённый сбалансированный вариант" : "Сбалансированный вариант", searchQuery: search.best, description: `Ищите решение среднего ценового сегмента с упором на «${priority}». Оно лучше всего подходит под запрос «${query}».${refinementNote}`, reasons: ["Закрывает главную потребность без лишней переплаты", `Подходит для сценария: ${context}`, `Бюджет и предложения стоит сравнивать в ${currency}`] },
    budget: { title: "Практичная базовая версия", searchQuery: search.budget, description: "Выберите надёжный вариант предыдущего поколения или с меньшим числом дополнительных функций.", reasons: ["Сохраняет основные возможности", "Проще обслуживать или заменить", "Хороший выбор при ограниченном бюджете"] },
    premium: { title: "Версия с запасом на будущее", searchQuery: search.premium, description: "Премиальный вариант оправдан, если улучшенные материалы, сервис и срок использования действительно важны.", reasons: ["Больше комфорта в ежедневном использовании", "Лучше поддержка и комплектация", "Дольше сохраняет актуальность"] },
    avoid: { title: "Слишком дешёвых обещаний", searchQuery: search.avoid, description: "Избегайте вариантов без понятной гарантии, отзывов и прозрачных условий.", reasons: ["Скрытые расходы могут убрать всю экономию", "Сложнее вернуть или обслужить", "Характеристики часто не подтверждаются"] },
    finalAdvice: `Сначала проверьте два главных критерия — «${priority}» и соответствие вашему сценарию.${refinementNote} Затем сравните 2–3 финальных варианта и выбирайте самый понятный, а не самый насыщенный функциями.`,
    confidence: 72,
    freshnessNote: "Демо-рекомендация без проверки текущих цен и наличия",
    updatedAt: new Date().toISOString(),
    demo: true
  };
};
const demoFor = (url, body) => url === "/api/questions" ? demoQuestions(body.query) : enrichRecommendation(demoResult(body), body.query, detectCategory(body.query));
const readBody = req => new Promise((resolve, reject) => {
  let raw = ""; req.on("data", chunk => { raw += chunk; if (Buffer.byteLength(raw) > maxBodyBytes) reject(Object.assign(new Error("Request too large"), { status: 413 })); });
  req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("Invalid JSON")); } }); req.on("error", reject);
});
const send = (req, res, status, data, extraHeaders = {}) => {
  const origin = req.headers.origin;
  const allowOrigin = isOriginAllowed(origin) ? origin : undefined;
  res.writeHead(status, {
  "Content-Type": "application/json; charset=utf-8",
  ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin, Vary: "Origin" } : {}),
  "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
  ...extraHeaders,
}); res.end(JSON.stringify(data)); };

async function structured(name, schema, instructions, input) {
  const response = await client.responses.create({
    model, instructions, input,
    text: { format: { type: "json_schema", name, strict: true, schema } }
  });
  if (!response.output_text) throw new Error("Пустой ответ модели");
  return JSON.parse(response.output_text);
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) return send(req, res, 403, { error: "Origin not allowed", requestId });
  if (req.method === "OPTIONS") return send(req, res, 204, {});
  if (req.url === "/health") return send(req, res, 200, { ok: true, model, configured: Boolean(client), demoFallback, openaiMaxRetries });
  const rate = checkRateLimit(req);
  const rateHeaders = { "X-RateLimit-Limit": String(rateLimitMax), "X-RateLimit-Remaining": String(rate.remaining), "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)) };
  if (!rate.allowed) return send(req, res, 429, { error: "Слишком много запросов. Попробуйте через минуту.", requestId }, { ...rateHeaders, "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) });
  if (req.method !== "POST" || !["/api/questions", "/api/recommendations"].includes(req.url || "")) return send(req, res, 404, { error: "Not found", requestId }, rateHeaders);
  let body;
  try {
    body = await readBody(req);
    if (!body.query || typeof body.query !== "string" || body.query.trim().length > 2000) return send(req, res, 400, { error: "Введите корректный запрос до 2000 символов", requestId }, rateHeaders);
    if (!client) {
      console.log("Демо-режим: API-ключ не настроен");
      return send(req, res, 200, demoFor(req.url, body), rateHeaders);
    }
    if (req.url === "/api/questions") {
      const category = detectCategory(body.query);
      const data = await structured("choice_questions", questionSchema,
        "Ты — умный помощник выбора «Выбор+». Задай 2–4 коротких уточняющих вопроса на русском. Для товара уточняй бюджет, сценарий и характеристики; подарка — получателя, повод и интересы; места — локацию, дату и атмосферу; услуги — локацию, задачу, срок и критерии исполнителя; личного решения — варианты, приоритеты и риски. Не спрашивай валюту: она уже определена. Не повторяй информацию из запроса.",
        JSON.stringify({ query: body.query, currency: body.currency, category }));
      return send(req, res, 200, { ...data, category }, rateHeaders);
    }
    const data = await structured("choice_result", resultSchema,
      "Ты — эксперт по выбору. Дай конкретные, практичные и честные рекомендации на русском. Соблюдай указанную валюту. Не выдумывай точные текущие цены; обозначай их как ориентиры. Для товаров называй конкретную модель, для услуг и мест — конкретный тип или название. В searchQuery возвращай короткую фразу для поиска именно этого варианта на маркетплейсе или сервисе, без пояснений и кавычек. confidence — твоя оценка уверенности 0–100 с учётом полноты данных. freshnessNote честно сообщает, проверялись ли текущие цены и наличие. updatedAt — текущая дата в ISO 8601.",
      JSON.stringify({ query: body.query, currency: body.currency, answers: body.answers || {} }));
    return send(req, res, 200, enrichRecommendation(data, body.query, detectCategory(body.query)), rateHeaders);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", requestId, path: req.url, status: error?.status, message: error?.message }));
    if (demoFallback && body?.query) return send(req, res, 200, demoFor(req.url, body), { ...rateHeaders, "X-Demo-Fallback": "true" });
    const status = Number(error?.status) || 500;
    const safeStatus = [400, 401, 403, 413, 429].includes(status) ? status : 500;
    const message = safeStatus === 413 ? "Запрос слишком большой" : safeStatus === 429 ? "AI временно недоступен из-за лимита" : "Не удалось обработать запрос";
    return send(req, res, safeStatus, { error: message, requestId }, rateHeaders);
  }
});
server.requestTimeout = requestTimeoutMs + 5000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, "0.0.0.0", () => console.log(`Выбор+ API: http://localhost:${port} · model: ${model}`));
