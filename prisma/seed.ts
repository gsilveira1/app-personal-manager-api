import { PrismaClient, ClientStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Upsert plan by name+userId (no compound unique in schema, so use findFirst)
async function upsertPlan(userId: string, data: {
  type: string; name: string; sessionsPerWeek: number; durationMinutes?: number; price: number;
}) {
  const existing = await prisma.plan.findFirst({ where: { userId, name: data.name } });
  if (existing) {
    return prisma.plan.update({ where: { id: existing.id }, data });
  }
  return prisma.plan.create({ data: { ...data, userId } });
}

async function main() {
  console.log('🌱 Iniciando Seed...');

  // ──────────────────────────────────────────
  // 1. Trainer (admin)
  // ──────────────────────────────────────────
  const passwordHash = await bcrypt.hash('admin123', 10);
  const trainer = await prisma.user.upsert({
    where: { email: 'admin@gym.com' },
    update: {},
    create: { name: 'Vivi Personal', email: 'admin@gym.com', password: passwordHash, role: 'admin' },
  });
  console.log(`✅ Trainer: ${trainer.id}`);

  // ──────────────────────────────────────────
  // 2. Planos (baseados na realidade dos clientes)
  // ──────────────────────────────────────────
  const [p2x30, p3x30, p4x60, p3x60, cBasica, cCompleta] = await Promise.all([
    upsertPlan(trainer.id, { type: 'PRESENCIAL', name: 'Presencial 2x 30min', sessionsPerWeek: 2, durationMinutes: 30, price: 0 }),
    upsertPlan(trainer.id, { type: 'PRESENCIAL', name: 'Presencial 3x 30min', sessionsPerWeek: 3, durationMinutes: 30, price: 0 }),
    upsertPlan(trainer.id, { type: 'PRESENCIAL', name: 'Presencial 4x 60min', sessionsPerWeek: 4, durationMinutes: 60, price: 0 }),
    upsertPlan(trainer.id, { type: 'PRESENCIAL', name: 'Presencial 3x 60min', sessionsPerWeek: 3, durationMinutes: 60, price: 0 }),
    upsertPlan(trainer.id, { type: 'CONSULTORIA', name: 'Consultoria Básica',    sessionsPerWeek: 1, price: 0 }),
    upsertPlan(trainer.id, { type: 'CONSULTORIA', name: 'Consultoria Completa',  sessionsPerWeek: 2, price: 0 }),
  ]);
  console.log('✅ Planos: 6 upserted');

  // ──────────────────────────────────────────
  // 3. Clientes reais
  // ──────────────────────────────────────────
  const clients = [
    {
      name: 'Ana Luísa Timmen',
      phone: '51 99184-9376',
      email: 'ana.timmen@sem-email.vivi',
      dateOfBirth: new Date('2009-09-24'),
      goal: 'Manter massa magra e emagrecer',
      planId: p2x30.id,
    },
    {
      name: 'Adriana Parada',
      phone: '51 99264-1343',
      email: 'adriana.parada@sem-email.vivi',
      dateOfBirth: new Date('1988-09-30'),
      goal: 'Emagrecer',
      planId: p2x30.id,
    },
    {
      name: 'Angélica Eltz',
      phone: '51 99128-6543',
      email: 'angelica@hintermetropolitana.com.br',
      dateOfBirth: new Date('1969-08-03'),
      goal: 'Emagrecer e manter massa magra',
      planId: p3x30.id,
    },
    {
      name: 'Cássia Franck Ferreira',
      phone: '51 98176-0721',
      email: 'cassiafranck.adv@gmail.com',
      dateOfBirth: new Date('1992-06-01'),
      goal: 'Emagrecer com saúde',
      planId: p3x30.id,
    },
    {
      name: 'Cristiane Veridiana Martin',
      phone: '51 99131-3787',
      email: 'smecristiane@gmail.com',
      dateOfBirth: new Date('1975-07-29'),
      goal: 'Emagrecer e manter massa magra',
      planId: p2x30.id,
    },
    {
      name: 'Cristiane Adam Grings',
      phone: '51 99105-0808',
      email: 'cristiane.grings@sem-email.vivi',
      dateOfBirth: null,
      goal: 'Emagrecer, manter massa magra, melhorar lipedema',
      planId: p2x30.id,
    },
    {
      name: 'Edina Fagundes',
      phone: '51 99988-4445',
      email: 'edina.fagundes@sem-email.vivi',
      dateOfBirth: new Date('1962-07-05'),
      goal: 'Recuperação, estética, lazer, saúde',
      planId: p2x30.id,
    },
    {
      name: 'Fernanda Capovilla',
      phone: '51 99192-1300',
      email: 'arqnadacapovilla@gmail.com',
      dateOfBirth: new Date('1987-01-16'),
      goal: 'Emagrecer, manter músculo e tratar lipedema',
      planId: p2x30.id,
    },
    {
      name: 'Júlia Venter Ribeiro',
      phone: '51 99471-3444',
      email: 'jventerribeiro@gmail.com',
      dateOfBirth: new Date('2007-02-01'),
      goal: 'Perder peso / manter massa magra',
      planId: p2x30.id,
    },
    {
      name: 'Irenilda Lopes Santos',
      phone: '51 98065-8456',
      email: 'Irenilda.santos@reforx.com.br',
      dateOfBirth: new Date('1967-07-28'),
      goal: 'Emagrecer e manter massa magra',
      planId: p4x60.id,
    },
    {
      name: 'Liane Capovilla',
      phone: '51 99124-7402',
      email: 'liane.capovilla@sem-email.vivi',
      dateOfBirth: null,
      goal: 'Saúde e emagrecimento',
      planId: p2x30.id,
    },
    {
      name: 'Lígia Maria Nehme',
      phone: '51 98411-1196',
      email: 'ligia.nehme@sem-email.vivi',
      dateOfBirth: new Date('1952-09-23'),
      goal: 'Saúde e emagrecimento',
      planId: p2x30.id,
    },
    {
      name: 'Mariana Sessim',
      phone: '51 98411-1197',
      email: 'mariana.sessim@sem-email.vivi',
      dateOfBirth: new Date('1983-01-06'),
      goal: 'Emagrecer e tratar lipedema',
      planId: p2x30.id,
    },
    {
      name: 'Patrícia Venter Ribeiro',
      phone: '51 98179-9029',
      email: 'bistrodapati@gmail.com',
      dateOfBirth: new Date('1984-09-25'),
      goal: 'Emagrecer',
      planId: p3x30.id,
    },
    {
      name: 'Tainara Machado Sarmento',
      phone: '51 99631-2360',
      email: 'tainaramachadosarmento@gmail.com',
      dateOfBirth: new Date('1992-03-12'),
      goal: 'Emagrecer e manter músculo',
      planId: p2x30.id,
    },
    {
      name: 'Sandro Borges',
      phone: '51 98432-2328',
      email: 'sandro.borges@sem-email.vivi',
      dateOfBirth: null,
      goal: null,
      planId: p3x30.id,
    },
    {
      name: 'Simone do Amaral',
      phone: '51 98547-7414',
      email: 'simone.amaral@sem-email.vivi',
      dateOfBirth: null,
      goal: null,
      planId: p3x60.id,
    },
  ];

  let created = 0, updated = 0;
  for (const c of clients) {
    const result = await prisma.client.upsert({
      where: { email: c.email },
      update: { name: c.name, phone: c.phone, dateOfBirth: c.dateOfBirth, goal: c.goal, planId: c.planId },
      create: {
        name: c.name,
        email: c.email,
        phone: c.phone,
        dateOfBirth: c.dateOfBirth,
        goal: c.goal,
        status: ClientStatus.Active,
        type: 'In-Person',
        userId: trainer.id,
        planId: c.planId,
      },
    });
    if (result.createdAt === result.updatedAt) created++; else updated++;
  }
  console.log(`✅ Clientes: ${created} criados, ${updated} atualizados`);

  // ──────────────────────────────────────────
  // 4. Configurações
  // ──────────────────────────────────────────
  await prisma.userSetting.upsert({
    where: { userId_key: { userId: trainer.id, key: 'ai_prompt_instructions' } },
    update: {},
    create: {
      userId: trainer.id,
      key: 'ai_prompt_instructions',
      value: 'Você é um treinador experiente focado em biomecânica.',
    },
  });

  console.log('🚀 Seed finalizado!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
