Como Usar

Para zerar o banco:
npm run db:reset

Para popular o banco (seed):
npm run db:seed
# OU, usando o comando nativo do Prisma (requer a config "prisma" no package.json)
npx prisma db seed

Para fazer tudo de uma vez (Refresh):
npm run db:refresh

Run npx prisma generate to fix the client.
Run npx tsc --noEmit (if available) or check if prisma/seed.ts shows no errors.