FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tar gzip && rm -rf /var/lib/apt/lists/*
WORKDIR /bootstrap
COPY source.tgz /tmp/kontentor-source.tgz
RUN mkdir -p /app && tar -xzf /tmp/kontentor-source.tgz -C /app

# KONTENTOR R4 overlays: Gemini-first text intelligence; approved UI/logo stay inside source.tgz unchanged.
COPY overlay/ /app/
RUN node -e "const fs=require('fs'); const p='/app/lib/channel-analysis.ts'; let s=fs.readFileSync(p,'utf8'); s=s.replaceAll('process.env.OPENAI_API_KEY','(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)'); s=s.replaceAll('OPENAI_API_KEY не подключён','GEMINI_API_KEY/OPENAI_API_KEY не подключён'); s=s.replaceAll('подключите OpenAI API','подключите Gemini API (или OpenAI как резерв)'); s=s.replaceAll('Без AI API','Без Gemini/OpenAI API'); fs.writeFileSync(p,s); const a='/app/lib/autopilot.ts'; let ap=fs.readFileSync(a,'utf8'); ap=ap.replaceAll('process.env.OPENAI_API_KEY','(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)').replaceAll('Для AI-стратега и автопилота нужен OPENAI_API_KEY.','Для AI-стратега и автопилота нужен GEMINI_API_KEY или OPENAI_API_KEY.'); fs.writeFileSync(a,ap); const e='/app/.env.example'; let env=fs.readFileSync(e,'utf8'); if(!env.includes('GEMINI_API_KEY')) env=env.replace('# OpenAI: текст, Radar, AI-стратег и адаптация под площадки.','# Gemini Free Tier — основной провайдер текста, аналитики и автоконтента.\nGEMINI_API_KEY=\"\"\nGEMINI_MODEL=\"gemini-3.8-flash\"\n\n# OpenAI — необязательный резерв для текста; изображения медиа-студии пока используют OpenAI.\n# OpenAI: текст, Radar, AI-стратег и адаптация под площадки.'); fs.writeFileSync(e,env);"

WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/kontentor
RUN npm install
RUN npm audit --audit-level=high
RUN npm run db:generate
RUN npm run build

FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3000
CMD ["sh","-c","npm run db:push && npm start"]
