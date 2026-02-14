FROM node:25-alpine AS builder

WORKDIR /app

# Copia apenas arquivos de dependência primeiro para cachear camadas
COPY package*.json ./
COPY prisma ./prisma/

# Instala dependências
RUN npm ci

# Copia o código fonte
COPY . .

# Gera o cliente Prisma e faz o build do NestJS
RUN npx prisma generate
RUN npm run build

# Estágio de Produção (Imagem final leve)
FROM node:25-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Usuário não-root por segurança
USER node

EXPOSE 3000

CMD ["npm", "run", "start:prod"]