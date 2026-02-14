import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log('🗑️  Zerando o banco de dados...');

  try {
    // Busca todas as tabelas no schema public
    const tablenames = await prisma.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== '_prisma_migrations'); // Não apagar histórico de migrações

    for (const table of tables) {
      // "TRUNCATE ... CASCADE" limpa a tabela e todas as dependências de FK
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      console.log(`   - Tabela "${table}" limpa.`);
    }

    console.log('✅ Banco de dados zerado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao zerar banco:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase();