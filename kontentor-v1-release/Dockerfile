FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tar gzip && rm -rf /var/lib/apt/lists/*
WORKDIR /bootstrap
COPY source.tgz /tmp/kontentor-source.tgz
RUN mkdir -p /app && tar -xzf /tmp/kontentor-source.tgz -C /app
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/kontentor
RUN npm install
RUN node -e "const fs=require('fs'),z=require('zlib');const h=z.gzipSync(fs.readFileSync('package-lock.json')).toString('hex');console.log('LOCK_HEX_BEGIN');for(let i=0;i<h.length;i+=120)console.log(h.slice(i,i+120));console.log('LOCK_HEX_END')"
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
