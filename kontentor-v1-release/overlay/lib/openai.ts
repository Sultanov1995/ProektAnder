export type AiAction = "generate" | "improve" | "shorten" | "cta";

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

type TextAIOptions = {
  instructions: string;
  input: string;
  maxOutputTokens: number;
  jsonMode?: boolean;
};

export function isTextAIConfigured() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

function extractOpenAIText(data: OpenAIResponse) {
  if (data.output_text?.trim()) return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text!.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractGeminiText(data: GeminiResponse) {
  return (data.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => typeof part.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanJsonText(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  return trimmed;
}

async function runGemini(options: TextAIOptions) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не настроен на сервере.");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `${options.instructions}\n\n${options.jsonMode ? "Верни строго валидный JSON без Markdown и без пояснений.\n\n" : ""}${options.input}`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.jsonMode ? 0.25 : 0.55,
          ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
      cache: "no-store",
    },
  );
  const data = await response.json() as GeminiResponse;
  if (!response.ok) throw new Error(data.error?.message || `Gemini API: ${response.status}`);
  const output = extractGeminiText(data);
  if (!output) throw new Error("Gemini не вернул текст.");
  return options.jsonMode ? cleanJsonText(output) : output;
}

async function runOpenAI(options: TextAIOptions) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY не настроен на сервере.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      store: false,
      instructions: options.instructions,
      input: options.jsonMode
        ? `Верни строго валидный JSON без Markdown и без пояснений.\n\n${options.input}`
        : options.input,
      max_output_tokens: options.maxOutputTokens,
    }),
    cache: "no-store",
  });
  const data = await response.json() as OpenAIResponse;
  if (!response.ok) throw new Error(data.error?.message || `OpenAI API: ${response.status}`);
  const output = extractOpenAIText(data);
  if (!output) throw new Error("OpenAI не вернул текст.");
  return options.jsonMode ? cleanJsonText(output) : output;
}

async function runTextAI(options: TextAIOptions) {
  if (process.env.GEMINI_API_KEY) return runGemini(options);
  if (process.env.OPENAI_API_KEY) return runOpenAI(options);
  throw new Error("GEMINI_API_KEY или OPENAI_API_KEY не настроен на сервере KONTENTOR.");
}

function promptFor(action: AiAction, text: string) {
  const rules = [
    "Пиши на русском языке.",
    "Верни только готовый текст публикации без пояснений и служебных комментариев.",
    "Не выдумывай факты, цифры, источники или цитаты, которых нет во входных данных.",
    "Сохраняй фактический смысл и ссылки, если они есть.",
    "Текст должен подходить для Telegram и быть не длиннее 4096 символов.",
    "Избегай дешёвого кликбейта, чрезмерных эмодзи и канцелярита.",
  ].join(" ");

  const tasks: Record<AiAction, string> = {
    generate: "На основе темы или черновых тезисов создай самостоятельный сильный Telegram-пост: цепляющее начало, ясная структура, практическая ценность и аккуратный финал.",
    improve: "Отредактируй текст: сделай его яснее, сильнее, естественнее и лучше структурированным. Удали повторы и слабые формулировки.",
    shorten: "Сократи текст примерно на 30–40%, сохранив главную мысль, факты и естественный стиль.",
    cta: "Сохрани основной текст и добавь в конце один уместный, ненавязчивый призыв к действию, соответствующий содержанию.",
  };

  return `${rules}\n\nЗадача: ${tasks[action]}\n\nВходной текст:\n${text}`;
}

export async function runContentAI(action: AiAction, text: string) {
  const output = await runTextAI({
    instructions: "Ты редактор KONTENTOR — ИИ-платформы для управления соцсетями. Создавай качественный, естественный и полезный контент без выдуманных фактов.",
    input: promptFor(action, text),
    maxOutputTokens: 1800,
  });
  return output.slice(0, 4096);
}

export async function createRadarDraft(input: { title: string; snippet?: string; sourceName: string; url: string; publishedAt?: string }) {
  const sourceBlock = [
    `Заголовок источника: ${input.title}`,
    input.snippet ? `Фрагмент материала: ${input.snippet}` : "",
    `Источник: ${input.sourceName}`,
    input.publishedAt ? `Дата материала: ${input.publishedAt}` : "",
    `Ссылка: ${input.url}`,
  ].filter(Boolean).join("\n");

  const output = await runTextAI({
    instructions: "Ты редактор KONTENTOR. Превращай найденные материалы в самостоятельные русскоязычные Telegram-посты. Не копируй исходник длинными фрагментами и не выдумывай факты.",
    input: `Создай оригинальный Telegram-пост на основе данных ниже.

Правила:
- Верни только готовый текст.
- Не приписывай источнику факты, которых нет во входных данных.
- Если данных мало, сформулируй аккуратно и не додумывай детали.
- Сделай сильное, но не кликбейтное начало.
- Объясни, почему тема полезна читателю.
- Объём желательно 900–2200 знаков, максимум 3800.
- В конце отдельной строкой обязательно укажи: «Источник: ${input.url}».

${sourceBlock}`,
    maxOutputTokens: 1800,
  });
  return output.slice(0, 4096);
}

export type WeeklyStrategyAIInput = {
  weekStart: string;
  dates: string[];
  timezone: string;
  preferredTimes: string[];
  dailyLimit: number;
  allowWeekend: boolean;
  connectedPlatforms: Array<"telegram" | "instagram" | "vk" | "youtube">;
  channelTitle?: string;
  instagramUsername?: string;
  vkGroupName?: string;
  youtubeChannelTitle?: string;
  audience?: { currentMembers?: number; delta?: number };
  detailedStats?: { viewsPerPost?: number; sharesPerPost?: number; reactionsPerPost?: number; enabledNotificationsPercent?: number };
  instagramStats?: { followers?: number; reach?: number; views?: number; accountsEngaged?: number; totalInteractions?: number };
  vkStats?: { members?: number; viewsPerPost?: number; likesPerPost?: number; commentsPerPost?: number; repostsPerPost?: number };
  youtubeStats?: { subscribers?: number; views?: number; watchMinutes?: number; likes?: number; comments?: number; shares?: number; subscribersGained?: number; subscribersLost?: number };
  recentPublications: Array<{ date: string; text: string; status: string; platforms?: string[] }>;
  radarItems: Array<{ id: string; title: string; score: number; url: string; snippet?: string }>;
};

export type WeeklyStrategyAIResult = {
  summary: string;
  focus: string;
  actions: string[];
  posts: Array<{
    date: string;
    time: string;
    topic: string;
    angle: string;
    objective: string;
    format: string;
    platforms: Array<"telegram" | "instagram" | "vk" | "youtube">;
    sourceRadarId: string;
    sourceUrl: string;
  }>;
};

export async function createWeeklyStrategyWithAI(input: WeeklyStrategyAIInput): Promise<WeeklyStrategyAIResult> {
  const radarText = input.radarItems.length
    ? input.radarItems.map((item) => `- ID=${item.id}; score=${item.score}/100; ${item.title}; ${item.url}; ${item.snippet || "без фрагмента"}`).join("\n")
    : "Radar пока не нашёл материалов.";
  const recentText = input.recentPublications.length
    ? input.recentPublications.map((item) => `- ${item.date}: [${item.status}] ${item.text.slice(0, 280)}`).join("\n")
    : "История публикаций пока пустая.";

  const output = await runTextAI({
    instructions: "Ты мультиплатформенный AI-стратег KONTENTOR. Планируй контент для подключённых Telegram, Instagram, VK и YouTube на русском языке. Не выдумывай факты или метрики. Верни JSON с полями summary, focus, actions и posts.",
    input: `Составь недельный контент-план.
Неделя: ${input.weekStart}
Разрешённые даты: ${input.dates.join(", ")}
Часовой пояс: ${input.timezone}
Предпочтительные часы: ${input.preferredTimes.join(", ")}
Максимум публикаций в день: ${input.dailyLimit}
Выходные разрешены: ${input.allowWeekend ? "да" : "нет"}
Подключённые площадки: ${input.connectedPlatforms.join(", ") || "нет"}
Telegram: ${input.channelTitle || "не подключён"}
Telegram аудитория: ${JSON.stringify(input.audience || {})}
Telegram детализация: ${JSON.stringify(input.detailedStats || {})}
Instagram: ${input.instagramUsername || "не подключён"}; ${JSON.stringify(input.instagramStats || {})}
VK: ${input.vkGroupName || "не подключён"}; ${JSON.stringify(input.vkStats || {})}
YouTube: ${input.youtubeChannelTitle || "не подключён"}; ${JSON.stringify(input.youtubeStats || {})}

Последние публикации:
${recentText}

Radar:
${radarText}

Верни JSON:
{
  "summary":"...",
  "focus":"...",
  "actions":["...", "...", "..."],
  "posts":[
    {"date":"YYYY-MM-DD","time":"HH:MM","topic":"...","angle":"...","objective":"...","format":"...","platforms":["telegram"],"sourceRadarId":"","sourceUrl":""}
  ]
}
Правила: минимум 4 поста; только разрешённые даты и подключённые площадки; не превышай дневной лимит; если используется Radar, сохрани ID и URL, иначе оставь пустые строки.`,
    maxOutputTokens: 3500,
    jsonMode: true,
  });

  try {
    const parsed = JSON.parse(output) as WeeklyStrategyAIResult;
    if (!parsed.summary || !parsed.focus || !Array.isArray(parsed.actions) || !Array.isArray(parsed.posts)) throw new Error("Неполная структура");
    return parsed;
  } catch {
    throw new Error("ИИ вернул некорректную структуру недельного плана. Повторите генерацию.");
  }
}

export async function createStrategyPostDraft(input: {
  topic: string;
  angle: string;
  objective: string;
  format: string;
  sourceTitle?: string;
  sourceSnippet?: string;
  sourceUrl?: string;
}) {
  const source = input.sourceUrl
    ? `\nИсточник для фактов:\n${input.sourceTitle || "Материал"}\n${input.sourceSnippet || ""}\n${input.sourceUrl}`
    : "\nВнешний источник не задан. Не придумывай конкретные новости, цифры, цитаты или события.";

  const output = await runTextAI({
    instructions: "Ты редактор KONTENTOR. Пиши естественные, полезные Telegram-посты на русском языке. Не выдумывай факты. Верни только готовый текст публикации.",
    input: `Подготовь Telegram-пост для контент-плана.
Тема: ${input.topic}
Подача: ${input.angle}
Цель: ${input.objective}
Формат: ${input.format}${source}

Требования:
- до 3800 символов;
- сильное, но не кликбейтное начало;
- понятная структура;
- один уместный CTA в финале;
- если есть URL источника, добавь в конце отдельной строкой «Источник: URL».`,
    maxOutputTokens: 1800,
  });
  return output.slice(0, 4096);
}

export type CrossPlatformVariants = { telegram: string; instagram: string; vk: string; youtube: string };

export async function createCrossPlatformVariants(text: string): Promise<CrossPlatformVariants> {
  const output = await runTextAI({
    instructions: "Ты редактор KONTENTOR. Адаптируй один исходный материал под Telegram, Instagram, VK и YouTube на русском языке. Не выдумывай факты и не меняй ссылки. Верни строго JSON.",
    input: `Исходный текст:
${text}

Верни JSON:
{"telegram":"...","instagram":"...","vk":"...","youtube":"..."}

Требования:
- telegram: до 3800 символов;
- instagram: до 2100 символов, сильный первый абзац;
- vk: до 5000 символов, естественная подача для сообщества;
- youtube: до 5000 символов, описание видео с сильными первыми строками и CTA.
Сохрани факты и ссылки из исходника.`,
    maxOutputTokens: 4200,
    jsonMode: true,
  });

  try {
    const parsed = JSON.parse(output) as CrossPlatformVariants;
    if (!parsed.telegram?.trim() || !parsed.instagram?.trim() || !parsed.vk?.trim() || !parsed.youtube?.trim()) throw new Error("Неполный ответ");
    return {
      telegram: parsed.telegram.slice(0, 4096),
      instagram: parsed.instagram.slice(0, 2200),
      vk: parsed.vk.slice(0, 5000),
      youtube: parsed.youtube.slice(0, 5000),
    };
  } catch {
    throw new Error("ИИ вернул некорректные версии публикации. Повторите адаптацию.");
  }
}

export type MediaStudioFormat = "square" | "portrait" | "story" | "landscape";
const mediaSizes: Record<MediaStudioFormat,string> = { square:"1024x1024", portrait:"1088x1360", story:"1088x1920", landscape:"1536x1024" };

export async function generateMediaImage(input:{prompt:string;format:MediaStudioFormat;quality?:"low"|"medium"|"high"}) {
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Бесплатный Gemini-режим сейчас используется для текста и аналитики. Для генерации изображений в текущей медиа-студии нужен OPENAI_API_KEY.");
  const response=await fetch("https://api.openai.com/v1/images/generations",{
    method:"POST",
    headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},
    body:JSON.stringify({
      model:process.env.OPENAI_IMAGE_MODEL||"gpt-image-2.5-flare",
      prompt:`Создай профессиональный визуал для публикации в соцсетях. Без логотипов сторонних брендов и без мелкого нечитаемого текста. Стиль KONTENTOR: современный, чистый, коммерческий. Задача пользователя: ${input.prompt}`,
      size:mediaSizes[input.format],quality:input.quality||"medium",output_format:"jpeg",output_compression:90,n:1
    }),
    cache:"no-store"
  });
  const data=await response.json() as {data?:Array<{b64_json?:string}>;error?:{message?:string}};
  if(!response.ok) throw new Error(data.error?.message||`OpenAI Images API: ${response.status}`);
  const b64=data.data?.[0]?.b64_json;
  if(!b64) throw new Error("ИИ не вернул изображение.");
  return {buffer:Buffer.from(b64,"base64"),mimeType:"image/jpeg",size:mediaSizes[input.format],model:process.env.OPENAI_IMAGE_MODEL||"gpt-image-2.5-flare"};
}

export async function editMediaImage(input:{buffer:Buffer;mimeType:string;prompt:string;format:MediaStudioFormat;quality?:"low"|"medium"|"high"}) {
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Бесплатный Gemini-режим сейчас используется для текста и аналитики. Для редактирования изображений в текущей медиа-студии нужен OPENAI_API_KEY.");
  if(!["image/jpeg","image/png","image/webp"].includes(input.mimeType)) throw new Error("Редактирование поддерживает JPG, PNG и WEBP.");
  const form=new FormData();
  const bytes=new Uint8Array(input.buffer);
  form.set("model",process.env.OPENAI_IMAGE_EDIT_MODEL||"gpt-image-2.5-sunburst");
  form.set("prompt",`Отредактируй исходное изображение согласно инструкции. Сохрани полезные элементы исходника. Инструкция пользователя: ${input.prompt}`);
  form.set("image",new Blob([bytes],{type:input.mimeType}),input.mimeType==="image/png"?"source.png":input.mimeType==="image/webp"?"source.webp":"source.jpg");
  form.set("size",mediaSizes[input.format]);
  form.set("quality",input.quality||"medium");
  form.set("output_format","jpeg");
  form.set("output_compression","90");
  const response=await fetch("https://api.openai.com/v1/images/edits",{method:"POST",headers:{authorization:`Bearer ${apiKey}`},body:form,cache:"no-store"});
  const data=await response.json() as {data?:Array<{b64_json?:string}>;error?:{message?:string}};
  if(!response.ok) throw new Error(data.error?.message||`OpenAI Images Edit API: ${response.status}`);
  const b64=data.data?.[0]?.b64_json;
  if(!b64) throw new Error("ИИ не вернул отредактированное изображение.");
  return {buffer:Buffer.from(b64,"base64"),mimeType:"image/jpeg",size:mediaSizes[input.format],model:process.env.OPENAI_IMAGE_EDIT_MODEL||"gpt-image-2.5-sunburst"};
}

export type ChannelIntelligenceAIInput = {
  network: "telegram" | "instagram" | "vk" | "youtube";
  accountLabel: string;
  workspaceNiche?: string;
  brandVoice?: unknown;
  timezone: string;
  allowedDates: string[];
  preferredTimes: string[];
  metrics: Record<string, unknown>;
  contentSamples: Array<{ title?: string; text: string; metrics?: Record<string, number | undefined> }>;
  recentPublications: Array<{ date: string; text: string; status: string }>;
  radarItems: Array<{ title: string; score: number; snippet?: string; url: string }>;
  dataNotes: string[];
};

export type ChannelIntelligenceAIResult = {
  dataQuality: "low" | "medium" | "high";
  detectedNiche: string;
  summary: string;
  audienceProfile: string;
  strengths: string[];
  risks: string[];
  growthDirections: string[];
  contentPillars: Array<{ title: string; why: string; examples: string[] }>;
  recommendedFormats: Array<{ format: string; reason: string; frequency: string }>;
  nextDays: Array<{
    date: string;
    time: string;
    topic: string;
    angle: string;
    objective: string;
    format: string;
    hook: string;
    material: string;
    visualBrief: string;
    cta: string;
  }>;
};

export async function createChannelIntelligenceWithAI(input: ChannelIntelligenceAIInput): Promise<ChannelIntelligenceAIResult> {
  const sampleText = input.contentSamples.length
    ? input.contentSamples.slice(0, 12).map((item, index) => `#${index + 1} ${item.title || "Материал"}\n${item.text.slice(0, 1000)}\nМетрики: ${JSON.stringify(item.metrics || {})}`).join("\n\n")
    : "Доступных исходных публикаций площадка не предоставила.";
  const recentText = input.recentPublications.length
    ? input.recentPublications.slice(0, 15).map((item) => `- ${item.date} [${item.status}]: ${item.text.slice(0, 600)}`).join("\n")
    : "История публикаций KONTENTOR пока пустая.";
  const radarText = input.radarItems.length
    ? input.radarItems.slice(0, 10).map((item) => `- ${item.score}/100 ${item.title}: ${item.snippet || ""} ${item.url}`).join("\n")
    : "Radar пока не дал релевантных тем.";

  const output = await runTextAI({
    instructions: "Ты аналитик и контент-стратег KONTENTOR. Анализируй только переданные данные. Не выдумывай статистику, аудиторию, факты или прошлые результаты. Если данных мало — снижай dataQuality и объясняй ограничения. Пиши по-русски. Создавай готовые к согласованию материалы.",
    input: `Проведи глубокий анализ подключённой площадки и подготовь готовый контент на 5 ближайших дней.

Площадка: ${input.network}
Аккаунт: ${input.accountLabel}
Тематика рабочего пространства: ${input.workspaceNiche || "не указана"}
Tone of voice: ${JSON.stringify(input.brandVoice || {})}
Часовой пояс: ${input.timezone}
Разрешённые даты: ${input.allowedDates.join(", ")}
Предпочтительное время: ${input.preferredTimes.join(", ")}

Сырые метрики:
${JSON.stringify(input.metrics)}

Доступные примеры контента:
${sampleText}

История материалов KONTENTOR:
${recentText}

Radar:
${radarText}

Ограничения данных:
${input.dataNotes.join("\n") || "нет"}

Верни JSON строго такого вида:
{
  "dataQuality":"low|medium|high",
  "detectedNiche":"...",
  "summary":"...",
  "audienceProfile":"...",
  "strengths":["...","..."],
  "risks":["...","..."],
  "growthDirections":["...","...","..."],
  "contentPillars":[{"title":"...","why":"...","examples":["...","..."]}],
  "recommendedFormats":[{"format":"...","reason":"...","frequency":"..."}],
  "nextDays":[
    {"date":"YYYY-MM-DD","time":"HH:MM","topic":"...","angle":"...","objective":"...","format":"...","hook":"...","material":"...","visualBrief":"...","cta":"..."}
  ]
}

Требования:
1. Не выдавай предположение о тематике за факт.
2. Дай 3–6 направлений роста и 3–5 постоянных рубрик.
3. Создай ровно 5 nextDays.
4. Telegram/VK: material = готовый пост. Instagram: готовая подпись + visualBrief. YouTube: сценарный план/описание + visualBrief.
5. Не используй конкретные цифры или новости, если их нет во входных данных.
6. Используй только разрешённые даты и предпочтительное время.`,
    maxOutputTokens: 9000,
    jsonMode: true,
  });

  try {
    const parsed = JSON.parse(output) as ChannelIntelligenceAIResult;
    if (!parsed.summary || !parsed.detectedNiche || parsed.nextDays?.length !== 5) throw new Error("Неполная структура");
    if (!Array.isArray(parsed.strengths) || !Array.isArray(parsed.risks) || !Array.isArray(parsed.growthDirections)) throw new Error("Неполная структура");
    return parsed;
  } catch {
    throw new Error("ИИ вернул некорректную структуру анализа. Повторите запуск.");
  }
}
