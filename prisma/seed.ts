import { PrismaClient, ClientStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando Seed...');

  // 1. Criar Usuário Admin
  const passwordHash = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@gym.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@gym.com',
      password: passwordHash,
      role: 'admin'
    }
  });
  console.log(`✅ Usuário Admin criado: ${adminUser.id}`);

  // 2. Criar Planos (Vinculados ao Admin)
  const plansData = [
    { name: 'Starter Hybrid', sessionsPerWeek: 2, sessionDurationMinutes: 60, pricePerSession: 40 },
    { name: 'Pro Hybrid', sessionsPerWeek: 3, sessionDurationMinutes: 60, pricePerSession: 35 },
  ];
  const createdPlans = [];
  for (const p of plansData) {
    createdPlans.push(await prisma.plan.create({ data: { ...p, userId: adminUser.id } }));
  }

  // 3. Criar Clientes (Vinculados ao Admin)
  const client = await prisma.client.create({
    data: {
      name: 'Alice Freeman',
      email: 'alice@example.com',
      phone: '555-0101',
      status: ClientStatus.Active,
      type: 'In-Person',
      userId: adminUser.id, // Vínculo
      planId: createdPlans[0].id,
    }
  });
  console.log(`✅ Cliente criado: ${client.name}`);

  // 4. Configurações
  await prisma.userSetting.create({
    data: {
      userId: adminUser.id,
      key: 'ai_prompt_instructions',
      value: 'Você é um treinador experiente focado em biomecânica.',
    }
  });

  console.log('🚀 Seed finalizado!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });