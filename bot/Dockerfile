# Finch HTTP API — the endpoint the Bazantic gateway wraps.
# Build from the REPO ROOT:  docker build -f bot/Dockerfile -t finch-api .
FROM node:22-slim
WORKDIR /app

COPY bot/package.json bot/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN npm install tsx@^4.19.0   # runtime TS execution

COPY bot/src ./src
COPY bot/tsconfig.json ./
COPY SKILL.md ./SKILL.md

ENV NODE_ENV=production
ENV FINCH_HTTP_PORT=8787
ENV FINCH_SKILL_PATH=/app/SKILL.md
EXPOSE 8787

CMD ["npm", "run", "serve:prod"]
