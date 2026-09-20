import { PrismaClient, ClientStatus, TenantStatus, WhatsappStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { addDays, subDays, setHours, setMinutes } from 'date-fns';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function upsertPlan(
  userId: string,
  data: {
    type: string;
    name: string;
    sessionsPerWeek: number;
    durationMinutes?: number;
    price: number;
  },
) {
  const existing = await prisma.plan.findFirst({ where: { userId, name: data.name } });
  if (existing) {
    return prisma.plan.update({ where: { id: existing.id }, data });
  }
  return prisma.plan.create({ data: { ...data, userId } });
}

async function main() {
  console.log('🌱 [Seed] Iniciando população completa de todas as entidades do banco...');

  // ──────────────────────────────────────────
  // 1. Tenants (Multi-Tenant Core)
  // ──────────────────────────────────────────
  const tenantVivi = await prisma.tenant.upsert({
    where: { slug: 'vivi-personal' },
    update: {
      name: 'Vivi Personal Studio',
      primaryColor: '#10B981',
      setupCompleted: true,
      whatsappStatus: WhatsappStatus.CONNECTED,
      whatsappInstanceName: 'tenant-vivi-001',
      logoUrl: 'https://pub-r2.viviops.com/logos/vivi-logo.png',
    },
    create: {
      name: 'Vivi Personal Studio',
      slug: 'vivi-personal',
      status: TenantStatus.ACTIVE,
      primaryColor: '#10B981',
      logoUrl: 'https://pub-r2.viviops.com/logos/vivi-logo.png',
      whatsappInstanceName: 'tenant-vivi-001',
      whatsappStatus: WhatsappStatus.CONNECTED,
      setupCompleted: true,
      features: {
        maxStudents: 100,
        canUploadVideos: true,
        whatsappAlerts: true,
        aiAssistantEnabled: true,
      },
    },
  });

  const tenantElite = await prisma.tenant.upsert({
    where: { slug: 'elite-fit-studio' },
    update: {},
    create: {
      name: 'Elite Fit Studio',
      slug: 'elite-fit-studio',
      status: TenantStatus.ACTIVE,
      primaryColor: '#2563EB',
      logoUrl: 'https://pub-r2.viviops.com/logos/elite-logo.png',
      whatsappInstanceName: 'tenant-elite-002',
      whatsappStatus: WhatsappStatus.CONNECTED,
      setupCompleted: true,
    },
  });
  console.log(`✅ Tenants: Vivi (${tenantVivi.id}), Elite Fit (${tenantElite.id})`);

  // ──────────────────────────────────────────
  // 2. Users (Trainers / Admin)
  // ──────────────────────────────────────────
  const passwordHash = await bcrypt.hash('admin123', 10);
  const trainerVivi = await prisma.user.upsert({
    where: { email: 'admin@gym.com' },
    update: { tenantId: tenantVivi.id, role: 'admin' },
    create: {
      name: 'Viviana Personal',
      email: 'admin@gym.com',
      password: passwordHash,
      role: 'admin',
      phone: '+5551999999999',
      bio: 'Personal Trainer especialista em Hipertrofia Feminina, Reabilitação e Emagrecimento.',
      avatar: 'https://images.unsplash.com/photo-1594381898411-846e7d193883?auto=format&fit=crop&q=80&w=200',
      tenantId: tenantVivi.id,
    },
  });

  const trainerCarlos = await prisma.user.upsert({
    where: { email: 'carlos@elitefit.com' },
    update: { tenantId: tenantElite.id },
    create: {
      name: 'Carlos Oliveira',
      email: 'carlos@elitefit.com',
      password: passwordHash,
      role: 'trainer',
      phone: '+5551988888888',
      bio: 'Treinador de Alta Performance e Biomecânica.',
      tenantId: tenantElite.id,
    },
  });
  console.log(`✅ Users: Viviana (${trainerVivi.id}), Carlos (${trainerCarlos.id})`);

  // ──────────────────────────────────────────
  // 3. User Settings & AI Instructions
  // ──────────────────────────────────────────
  await prisma.userSetting.upsert({
    where: { userId_key: { userId: trainerVivi.id, key: 'ai_prompt' } },
    update: { value: 'Priorize cadência 3-0-1-0 e foco em amplitude máxima para alunos com queixas posturais.' },
    create: {
      userId: trainerVivi.id,
      key: 'ai_prompt',
      value: 'Priorize cadência 3-0-1-0 e foco em amplitude máxima para alunos com queixas posturais.',
    },
  });
  await prisma.userSetting.upsert({
    where: { userId_key: { userId: trainerVivi.id, key: 'preferred_language' } },
    update: { value: 'pt-BR' },
    create: {
      userId: trainerVivi.id,
      key: 'preferred_language',
      value: 'pt-BR',
    },
  });
  console.log('✅ User Settings configuradas');

  // ──────────────────────────────────────────
  // 4. Availability Blocks (Horários Bloqueados)
  // ──────────────────────────────────────────
  await prisma.availabilityBlock.deleteMany({ where: { userId: trainerVivi.id } });
  const today = new Date();
  await prisma.availabilityBlock.createMany({
    data: [
      {
        userId: trainerVivi.id,
        title: 'Horário de Almoço',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        timezone: 'America/Sao_Paulo',
        dtstart: setMinutes(setHours(today, 12), 0),
        dtend: setMinutes(setHours(today, 13), 30),
        notes: 'Almoço e descanso diário',
      },
      {
        userId: trainerVivi.id,
        title: 'Atualização e Estudos',
        rrule: 'FREQ=WEEKLY;BYDAY=FR',
        timezone: 'America/Sao_Paulo',
        dtstart: setMinutes(setHours(today, 18), 0),
        dtend: setMinutes(setHours(today, 19), 30),
        notes: 'Estudos de biomecânica',
      },
    ],
  });
  console.log('✅ Availability Blocks criados');

  // ──────────────────────────────────────────
  // 5. System Features & Plan Features
  // ──────────────────────────────────────────
  const featAi = await prisma.systemFeature.upsert({
    where: { key: 'ai_whatsapp_bot' },
    update: {},
    create: {
      key: 'ai_whatsapp_bot',
      name: 'Assistente WhatsApp com IA',
      description: 'Responde dúvidas e envia lembretes inteligentes para os alunos.',
      isActive: true,
    },
  });
  const featVideo = await prisma.systemFeature.upsert({
    where: { key: 'video_exercise_upload' },
    update: {},
    create: {
      key: 'video_exercise_upload',
      name: 'Vídeos Customizados de Exercícios',
      description: 'Permite anexar vídeos gravados pelo personal nos treinos.',
      isActive: true,
    },
  });
  const featPix = await prisma.systemFeature.upsert({
    where: { key: 'automated_pix' },
    update: {},
    create: {
      key: 'automated_pix',
      name: 'Cobrança Automática via PIX',
      description: 'Gera QR Code dinâmico do MercadoPago/Asaas.',
      isActive: true,
    },
  });
  console.log('✅ System Features configuradas');

  // ──────────────────────────────────────────
  // 6. Plans (Planos Presenciais e Consultoria)
  // ──────────────────────────────────────────
  const [p2x30, p3x30, p4x60, p3x60, cBasica, cCompleta] = await Promise.all([
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 2x 30min', sessionsPerWeek: 2, durationMinutes: 30, price: 350 }),
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 3x 30min', sessionsPerWeek: 3, durationMinutes: 30, price: 450 }),
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 4x 60min', sessionsPerWeek: 4, durationMinutes: 60, price: 650 }),
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 3x 60min', sessionsPerWeek: 3, durationMinutes: 60, price: 550 }),
    upsertPlan(trainerVivi.id, { type: 'CONSULTORIA', name: 'Consultoria Básica Online', sessionsPerWeek: 1, price: 180 }),
    upsertPlan(trainerVivi.id, { type: 'CONSULTORIA', name: 'Consultoria Completa Online', sessionsPerWeek: 2, price: 280 }),
  ]);

  // Vincular features aos planos
  await prisma.planFeature.deleteMany({ where: { planId: cCompleta.id } });
  await prisma.planFeature.createMany({
    data: [
      { planId: cCompleta.id, featureId: featAi.id },
      { planId: cCompleta.id, featureId: featVideo.id },
      { planId: p4x60.id, featureId: featPix.id },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Planos e PlanFeatures criados');

  // ──────────────────────────────────────────
  // 7. Exercise Library (Standard & Custom)
  // ──────────────────────────────────────────
  await prisma.exercise.deleteMany({});
  const exercisesData = [
    { name: 'Agachamento Livre', bodyPart: 'Pernas', targetMuscle: 'Quadríceps', equipment: 'Barra', gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300' },
    { name: 'Leg Press 45º', bodyPart: 'Pernas', targetMuscle: 'Quadríceps / Glúteos', equipment: 'Máquina', gifUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300' },
    { name: 'Cadeira Extensora', bodyPart: 'Pernas', targetMuscle: 'Quadríceps', equipment: 'Máquina', gifUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=300' },
    { name: 'Mesa Flexora', bodyPart: 'Pernas', targetMuscle: 'Posterior de Coxa', equipment: 'Máquina', gifUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=300' },
    { name: 'Stiff com Halteres', bodyPart: 'Pernas', targetMuscle: 'Posterior / Glúteos', equipment: 'Halteres', gifUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300' },
    { name: 'Elevação Pélvica com Barra', bodyPart: 'Pernas', targetMuscle: 'Glúteos', equipment: 'Barra', gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300' },
    { name: 'Supino Reto com Barra', bodyPart: 'Peitoral', targetMuscle: 'Peitoral Maior', equipment: 'Barra', gifUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=300' },
    { name: 'Supino Inclinado com Halteres', bodyPart: 'Peitoral', targetMuscle: 'Peitoral Superior', equipment: 'Halteres', gifUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300' },
    { name: 'Crucifixo na Máquina Peck Deck', bodyPart: 'Peitoral', targetMuscle: 'Peitoral', equipment: 'Máquina', gifUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=300' },
    { name: 'Puxada Alta Frontal', bodyPart: 'Costas', targetMuscle: 'Latíssimo do Dorso', equipment: 'Polia', gifUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300' },
    { name: 'Remada Curvada com Barra', bodyPart: 'Costas', targetMuscle: 'Dorsais / Romboides', equipment: 'Barra', gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300' },
    { name: 'Remada Baixa no Triângulo', bodyPart: 'Costas', targetMuscle: 'Dorsais', equipment: 'Polia', gifUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=300' },
    { name: 'Desenvolvimento com Halteres', bodyPart: 'Ombros', targetMuscle: 'Deltoide Anterior', equipment: 'Halteres', gifUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300' },
    { name: 'Elevação Lateral na Polia', bodyPart: 'Ombros', targetMuscle: 'Deltoide Lateral', equipment: 'Polia', gifUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=300' },
    { name: 'Rosca Direta na Barra W', bodyPart: 'Braços', targetMuscle: 'Bíceps Braquial', equipment: 'Barra', gifUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300' },
    { name: 'Tríceps Corda na Polia', bodyPart: 'Braços', targetMuscle: 'Tríceps', equipment: 'Polia', gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300' },
    { name: 'Prancha Abdominal Isométrica', bodyPart: 'Core', targetMuscle: 'Reto Abdominal', equipment: 'Peso Corporal', gifUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=300' },
    { name: 'Panturrilha em Pé na Máquina', bodyPart: 'Pernas', targetMuscle: 'Gastrocnêmio', equipment: 'Máquina', gifUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300' },
  ];

  const createdExercises = await Promise.all(
    exercisesData.map((ex) =>
      prisma.exercise.create({
        data: {
          ...ex,
          isCustom: false,
          userId: trainerVivi.id,
          tenantId: tenantVivi.id,
        },
      }),
    ),
  );
  console.log(`✅ Exercícios: ${createdExercises.length} cadastrados`);

  // ──────────────────────────────────────────
  // 8. 20 Clientes com dados ricos e realistas
  // ──────────────────────────────────────────
  const clientsData = [
    {
      name: 'Ana Luísa Timmen',
      phone: '+5551991849376',
      email: 'ana.timmen@viviops.client',
      dateOfBirth: new Date('2009-09-24'),
      goal: 'Manter massa magra e emagrecer',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Aluna muito dedicada. Preferência por treinos matinais.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Adriana Parada',
      phone: '+5551992641343',
      email: 'adriana.parada@viviops.client',
      dateOfBirth: new Date('1988-09-30'),
      goal: 'Emagrecimento e ganho de força',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Histórico de dor lombar; evitar flexão de tronco excessiva.',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Angélica Eltz',
      phone: '+5551991286543',
      email: 'angelica.eltz@viviops.client',
      dateOfBirth: new Date('1969-08-03'),
      goal: 'Emagrecer e manter massa magra na menopausa',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x30.id,
      notes: 'Foco em fortalecimento ósseo e muscular.',
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cássia Franck Ferreira',
      phone: '+5551981760721',
      email: 'cassia.franck@viviops.client',
      dateOfBirth: new Date('1992-06-01'),
      goal: 'Emagrecer com saúde e hipertrofia de glúteos',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x30.id,
      notes: 'Advogada, rotina corrida. Treinos objetivos e intensos.',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cristiane Veridiana Martin',
      phone: '+5551991313787',
      email: 'cristiane.martin@viviops.client',
      dateOfBirth: new Date('1975-07-29'),
      goal: 'Emagrecer e manter massa magra',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Excelente consistência nas terças e quintas.',
      avatar: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cristiane Adam Grings',
      phone: '+5551991050808',
      email: 'cristiane.grings@viviops.client',
      dateOfBirth: new Date('1982-11-14'),
      goal: 'Emagrecer, manter massa magra, melhorar lipedema',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Cuidado especial com retenção hídrica; foco em contrações isométricas.',
      avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cristiane Roxo',
      phone: '+5551999988112',
      email: 'cristiane.roxo@viviops.client',
      dateOfBirth: new Date('1978-04-12'),
      goal: 'Tonificação e condicionamento cardiovascular',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x30.id,
      notes: 'Treina sempre com a amiga Fabiane.',
      avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Fabiane Bitencourt',
      phone: '+5551988877223',
      email: 'fabiane.bitencourt@viviops.client',
      dateOfBirth: new Date('1980-01-20'),
      goal: 'Hipertrofia de membros inferiores',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x30.id,
      notes: 'Boa resposta neuromuscular.',
      avatar: 'https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Graziela Larruscaim',
      phone: '+5551997766334',
      email: 'graziela.larruscaim@viviops.client',
      dateOfBirth: new Date('1985-05-18'),
      goal: 'Saúde geral e mobilidade articular',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Alongamentos e mobilidade no início do treino.',
      avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Grazielle Pimentel',
      phone: '+5551996655445',
      email: 'grazielle.pimentel@viviops.client',
      dateOfBirth: new Date('1990-10-05'),
      goal: 'Definição muscular e emagrecimento',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Preferência por Bi-Sets para otimizar os 30 minutos.',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Juliana Souza',
      phone: '+5551995544332',
      email: 'juliana.souza@viviops.client',
      dateOfBirth: new Date('1995-12-15'),
      goal: 'Hipertrofia intensa e definição',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p4x60.id,
      notes: 'Treina 4 vezes na semana. Carga progressiva.',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Gabriela Silveira',
      phone: '+5551994433221',
      email: 'gabriela.silveira@viviops.client',
      dateOfBirth: new Date('1993-03-22'),
      goal: 'Preparação para corrida e força',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x60.id,
      notes: 'Corredora amadora de 10km.',
      avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Letícia Oliveira',
      phone: '+5551993322110',
      email: 'leticia.oliveira@viviops.client',
      dateOfBirth: new Date('1991-07-11'),
      goal: 'Consultoria online para academia de condomínio',
      modality: 'ONLINE',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: cCompleta.id,
      notes: 'Utiliza o PWA para executar os treinos e registrar cargas.',
      avatar: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Mariana Duarte',
      phone: '+5551992211009',
      email: 'mariana.duarte@viviops.client',
      dateOfBirth: new Date('1987-09-08'),
      goal: 'Consultoria online - Treino em casa com halteres',
      modality: 'ONLINE',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: cCompleta.id,
      notes: 'Mãe de 2 filhos, treina 40 min em casa.',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Rodrigo Mendes',
      phone: '+5551991100998',
      email: 'rodrigo.mendes@viviops.client',
      dateOfBirth: new Date('1984-02-17'),
      goal: 'Ganho de massa magra e postura',
      modality: 'ONLINE',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: cBasica.id,
      notes: 'Trabalho home office prolongado.',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Thiago Albuquerque',
      phone: '+5551990099887',
      email: 'thiago.albuquerque@viviops.client',
      dateOfBirth: new Date('1989-08-30'),
      goal: 'Performance e Hipertrofia',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p4x60.id,
      notes: 'Treinos pesados de força e potência.',
      avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Vanessa Camargo',
      phone: '+5551989988776',
      email: 'vanessa.camargo@viviops.client',
      dateOfBirth: new Date('1994-11-25'),
      goal: 'Híbrido: 2x presencial + 1x ficha no app',
      modality: 'HYBRID',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p2x30.id,
      notes: 'Excelente aderência e consistência.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Lucas Fontana',
      phone: '+5551988877665',
      email: 'lucas.fontana@viviops.client',
      dateOfBirth: new Date('1996-06-19'),
      goal: 'Híbrido: Reavaliação presencial + fichas online',
      modality: 'HYBRID',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: cCompleta.id,
      notes: 'Foco em evolução de cargas no agachamento e supino.',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Patrícia Helena',
      phone: '+5551987766554',
      email: 'patricia.helena@viviops.client',
      dateOfBirth: new Date('1976-03-14'),
      goal: 'Qualidade de vida e fortalecimento muscular',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x30.id,
      notes: 'Aluna assídua há mais de 1 ano.',
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Renata Vasconcellos',
      phone: '+5551986655443',
      email: 'renata.vasconcellos@viviops.client',
      dateOfBirth: new Date('1983-09-02'),
      goal: 'Condicionamento físico e emagrecimento',
      modality: 'PRESENCIAL',
      status: ClientStatus.Active,
      subscriptionStatus: 'ACTIVE',
      planId: p3x60.id,
      notes: 'Treinos dinâmicos com intervalo curto.',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200',
    },
  ];

  const createdClients = [];
  for (const c of clientsData) {
    const client = await prisma.client.upsert({
      where: { email: c.email },
      update: {
        name: c.name,
        phone: c.phone,
        goal: c.goal,
        modality: c.modality,
        status: c.status,
        subscriptionStatus: c.subscriptionStatus,
        planId: c.planId,
        notes: c.notes,
        avatar: c.avatar,
        dateOfBirth: c.dateOfBirth,
        type: c.modality === 'ONLINE' ? 'Online' : 'In-Person',
      },
      create: {
        ...c,
        type: c.modality === 'ONLINE' ? 'Online' : 'In-Person',
        userId: trainerVivi.id,
      },
    });
    createdClients.push(client);
  }
  console.log(`✅ 20 Clientes cadastrados com sucesso!`);

  // ──────────────────────────────────────────
  // 9. Anamneses e Reavaliações Físicas
  // ──────────────────────────────────────────
  const ana1 = createdClients[0];
  const adriana = createdClients[1];
  const cassia = createdClients[3];
  const juliana = createdClients[10];

  await prisma.anamnesis.deleteMany({ where: { userId: trainerVivi.id } });
  await prisma.anamnesis.createMany({
    data: [
      {
        clientId: ana1.id,
        userId: trainerVivi.id,
        isCurrent: true,
        token: 'token-anamnese-ana-001',
        tokenUsed: true,
        medicalHistory: 'Sem histórico de cirurgias. Pressão arterial normal.',
        injuriesAndPain: 'Nenhuma dor limitante atual.',
        routineAndSchedule: 'Estudante. Disponibilidade no início da manhã.',
        fitnessGoals: 'Emagrecimento saudável e definição de membros inferiores.',
        experienceLevel: 'Intermediário',
        weightKg: 58.5,
        parqAnswers: { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false },
        frontPhotoUrl: 'https://pub-r2.viviops.com/evaluations/ana-front.png',
        backPhotoUrl: 'https://pub-r2.viviops.com/evaluations/ana-back.png',
        sidePhotoUrl: 'https://pub-r2.viviops.com/evaluations/ana-side.png',
      },
      {
        clientId: adriana.id,
        userId: trainerVivi.id,
        isCurrent: true,
        token: 'token-anamnese-adriana-002',
        tokenUsed: true,
        medicalHistory: 'Episódios esporádicos de dor lombar em crises de estresse.',
        injuriesAndPain: 'Desconforto na região L4-L5 ao carregar peso em flexão.',
        routineAndSchedule: 'Trabalho em escritório (8h sentada).',
        fitnessGoals: 'Fortalecimento do core e perda de 4kg.',
        experienceLevel: 'Iniciante/Intermediário',
        weightKg: 64.0,
        parqAnswers: { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false },
      },
      {
        clientId: cassia.id,
        userId: trainerVivi.id,
        isCurrent: true,
        token: 'token-anamnese-cassia-003',
        tokenUsed: true,
        medicalHistory: 'Nenhum problema de saúde crônico.',
        fitnessGoals: 'Hipertrofia de glúteos e definição abdominal.',
        experienceLevel: 'Avançado',
        weightKg: 61.2,
      },
      {
        clientId: juliana.id,
        userId: trainerVivi.id,
        isCurrent: true,
        token: 'token-anamnese-juliana-004',
        tokenUsed: true,
        medicalHistory: 'Excelente saúde. Praticante de musculação há 4 anos.',
        fitnessGoals: 'Hipertrofia máxima e ganho de força.',
        experienceLevel: 'Avançado',
        weightKg: 67.5,
      },
    ],
  });
  console.log('✅ Anamneses cadastradas');

  // ──────────────────────────────────────────
  // 10. Avaliações Físicas e Dobras Cutâneas
  // ──────────────────────────────────────────
  await prisma.evaluation.deleteMany({ where: { clientId: { in: createdClients.map((c) => c.id) } } });
  await prisma.evaluation.createMany({
    data: [
      {
        clientId: ana1.id,
        date: subDays(today, 60),
        weight: 60.5,
        height: 165,
        bodyFatPercentage: 24.5,
        leanMass: 45.68,
        fatMass: 14.82,
        protocol: 'POLLOCK_3',
        skinfolds: { triceps: 14, suprailiac: 16, thigh: 20 },
        perimeters: { waist: 68, abdomen: 74, hips: 98, rightThigh: 54, rightArm: 26 },
        notes: 'Avaliação inicial com foco em redução de gordura.',
      },
      {
        clientId: ana1.id,
        date: subDays(today, 10),
        weight: 58.5,
        height: 165,
        bodyFatPercentage: 21.8,
        leanMass: 45.75,
        fatMass: 12.75,
        protocol: 'POLLOCK_3',
        skinfolds: { triceps: 12, suprailiac: 13, thigh: 17 },
        perimeters: { waist: 65, abdomen: 70, hips: 96, rightThigh: 54.5, rightArm: 26.5 },
        notes: 'Excelente evolução! Redução de 2kg de gordura e manutenção de massa magra.',
      },
      {
        clientId: juliana.id,
        date: subDays(today, 30),
        weight: 67.5,
        height: 170,
        bodyFatPercentage: 18.2,
        leanMass: 55.21,
        fatMass: 12.29,
        protocol: 'POLLOCK_7',
        skinfolds: { triceps: 10, subscapular: 11, pectoral: 8, axillary: 9, suprailiac: 10, abdominal: 12, thigh: 14 },
        perimeters: { waist: 66, abdomen: 72, hips: 102, rightThigh: 59, rightArm: 30 },
        notes: 'Composição corporal atleta. Foco em volume de deltoides e posteriores.',
      },
    ],
  });
  console.log('✅ Avaliações Físicas cadastradas');

  // ──────────────────────────────────────────
  // 11. Templates de Treino & Fichas A/B/C
  // ──────────────────────────────────────────
  await prisma.workoutTemplate.deleteMany({ where: { userId: trainerVivi.id } });
  await prisma.workoutTemplate.createMany({
    data: [
      {
        userId: trainerVivi.id,
        name: 'Hipertrofia Feminina A/B/C',
        description: 'Divisão A (Inferiores foco Quadríceps), B (Superiores + Core), C (Glúteos e Posterior).',
        structure: {
          days: ['A', 'B', 'C'],
          focus: 'Glúteos, Quadríceps e Dorsais',
        },
      },
      {
        userId: trainerVivi.id,
        name: 'Emagrecimento Full Body 30min',
        description: 'Treino metabólico em circuito com blocos Bi-Set.',
        structure: {
          duration: 30,
          type: 'Bi-Set Circuit',
        },
      },
    ],
  });

  // Criar WorkoutSheet para Ana Luísa e Juliana
  await prisma.workoutSheet.deleteMany({ where: { userId: trainerVivi.id } });
  const sheetAna = await prisma.workoutSheet.create({
    data: {
      userId: trainerVivi.id,
      clientId: ana1.id,
      name: 'Ficha Hipertrofia & Definição 2026',
      active: true,
      expiresAt: addDays(today, 45),
      workouts: {
        create: [
          {
            letter: 'A',
            name: 'Treino A - Quadríceps & Peitoral',
            orderIndex: 0,
            blocks: {
              create: [
                {
                  type: 'REGULAR',
                  orderIndex: 0,
                  restTimeSeconds: 60,
                  exercises: {
                    create: [
                      {
                        exerciseName: 'Agachamento Livre',
                        sets: 4,
                        reps: '10-12',
                        suggestedLoadKg: 30,
                        executionNotes: 'Descer até 90º com coluna neutra e joelhos alinhados com a ponta dos pés.',
                        orderIndex: 0,
                      },
                    ],
                  },
                },
                {
                  type: 'BISET',
                  orderIndex: 1,
                  restTimeSeconds: 45,
                  exercises: {
                    create: [
                      {
                        exerciseName: 'Leg Press 45º',
                        sets: 3,
                        reps: '12-15',
                        suggestedLoadKg: 80,
                        orderIndex: 0,
                      },
                      {
                        exerciseName: 'Cadeira Extensora',
                        sets: 3,
                        reps: '12-15 com pico de contração de 2s',
                        suggestedLoadKg: 35,
                        orderIndex: 1,
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            letter: 'B',
            name: 'Treino B - Glúteos & Costas',
            orderIndex: 1,
            blocks: {
              create: [
                {
                  type: 'REGULAR',
                  orderIndex: 0,
                  restTimeSeconds: 60,
                  exercises: {
                    create: [
                      {
                        exerciseName: 'Elevação Pélvica com Barra',
                        sets: 4,
                        reps: '10-12',
                        suggestedLoadKg: 60,
                        executionNotes: 'Segurar 2 segundos em cima com contração máxima.',
                        orderIndex: 0,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });
  console.log(`✅ Workout Sheet criado para ${ana1.name} (${sheetAna.id})`);

  // ──────────────────────────────────────────
  // 12. Student Sessions & Logs de Treino (Heatmap Data)
  // ──────────────────────────────────────────
  await prisma.studentSession.deleteMany({ where: { clientId: { in: createdClients.map((c) => c.id) } } });
  const studentSessionLogs = [];
  // Gera 15 sessões concluídas no último mês para alimentar o Heatmap
  for (let i = 1; i <= 20; i += 2) {
    studentSessionLogs.push({
      clientId: ana1.id,
      workoutName: i % 4 === 0 ? 'Treino B - Glúteos & Costas' : 'Treino A - Quadríceps & Peitoral',
      durationSeconds: 1800 + Math.floor(Math.random() * 600),
      completedAt: subDays(today, i),
      loads: {
        'Agachamento Livre': [30, 32.5, 35, 35],
        'Leg Press 45º': [80, 90, 90],
      },
    });
    studentSessionLogs.push({
      clientId: juliana.id,
      workoutName: 'Treino A - Força e Hipertrofia',
      durationSeconds: 3200,
      completedAt: subDays(today, i),
      loads: {
        'Elevação Pélvica com Barra': [70, 75, 80, 80],
      },
    });
  }
  await prisma.studentSession.createMany({ data: studentSessionLogs });
  console.log(`✅ ${studentSessionLogs.length} Student Sessions geradas para Heatmap`);

  // ──────────────────────────────────────────
  // 13. Agendamentos: Sessões e Eventos Recorrentes (RFC 5545)
  // ──────────────────────────────────────────
  await prisma.session.deleteMany({ where: { userId: trainerVivi.id } });
  await prisma.sessionException.deleteMany({});
  await prisma.recurringEvent.deleteMany({ where: { userId: trainerVivi.id } });

  // Sessões avulsas passadas e futuras
  await prisma.session.createMany({
    data: [
      {
        userId: trainerVivi.id,
        clientId: ana1.id,
        date: subDays(today, 2),
        durationMinutes: 30,
        type: 'In-Person',
        category: 'Workout',
        completed: true,
        notes: 'Treino excelente, aumentou carga no agachamento.',
      },
      {
        userId: trainerVivi.id,
        clientId: adriana.id,
        date: subDays(today, 1),
        durationMinutes: 30,
        type: 'In-Person',
        category: 'Workout',
        completed: true,
        notes: 'Sem queixas de dor lombar.',
      },
      {
        userId: trainerVivi.id,
        clientId: cassia.id,
        date: addDays(today, 1),
        durationMinutes: 30,
        type: 'In-Person',
        category: 'Workout',
        completed: false,
        notes: 'Treino de membros inferiores programado.',
      },
      {
        userId: trainerVivi.id,
        clientId: juliana.id,
        date: addDays(today, 2),
        durationMinutes: 60,
        type: 'In-Person',
        category: 'Workout',
        completed: false,
        notes: 'Sessão de 60min com teste de carga máxima.',
      },
    ],
  });

  // Eventos Recorrentes (RRULE) para clientes semanais
  const recAna = await prisma.recurringEvent.create({
    data: {
      userId: trainerVivi.id,
      clientId: ana1.id,
      rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=24',
      timezone: 'America/Sao_Paulo',
      dtstart: setMinutes(setHours(today, 8), 0),
      durationMinutes: 30,
      type: 'In-Person',
      category: 'Workout',
      notes: 'Presencial Terças e Quintas 08:00',
    },
  });

  const recJuliana = await prisma.recurringEvent.create({
    data: {
      userId: trainerVivi.id,
      clientId: juliana.id,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=36',
      timezone: 'America/Sao_Paulo',
      dtstart: setMinutes(setHours(today, 17), 0),
      durationMinutes: 60,
      type: 'In-Person',
      category: 'Workout',
      notes: 'Presencial Seg/Qua/Sex 17:00',
    },
  });

  // Exceção de cancelamento em uma ocorrência futura
  await prisma.sessionException.create({
    data: {
      recurringEventId: recAna.id,
      originalStartTime: setMinutes(setHours(addDays(today, 7), 8), 0),
      cancelled: true,
      notes: 'Cancelado a pedido da aluna para consulta médica.',
    },
  });
  console.log('✅ Sessões pontuais e Eventos Recorrentes (RRULE) configurados');

  // ──────────────────────────────────────────
  // 14. Pagamentos Manuais (ManualPayment)
  // ──────────────────────────────────────────
  await prisma.manualPayment.deleteMany({ where: { userId: trainerVivi.id } });
  await prisma.manualPayment.createMany({
    data: [
      {
        userId: trainerVivi.id,
        clientId: ana1.id,
        paymentType: 'MANUAL_PIX',
        amount: 350.0,
        validUntil: addDays(today, 25),
        notes: 'Mensalidade paga via chave PIX bancária.',
      },
      {
        userId: trainerVivi.id,
        clientId: juliana.id,
        paymentType: 'MANUAL_PIX',
        amount: 650.0,
        validUntil: addDays(today, 28),
        notes: 'Plano 4x 60min pago pontualmente.',
      },
      {
        userId: trainerVivi.id,
        clientId: adriana.id,
        paymentType: 'MANUAL_CASH',
        amount: 350.0,
        validUntil: addDays(today, 15),
        notes: 'Recebido em dinheiro no estúdio.',
      },
    ],
  });
  console.log('✅ Pagamentos Manuais registrados');

  // ──────────────────────────────────────────
  // 15. Notification Logs (WhatsApp Queues)
  // ──────────────────────────────────────────
  await prisma.notificationLog.deleteMany({});
  await prisma.notificationLog.createMany({
    data: [
      {
        tenantId: tenantVivi.id,
        recipientPhone: ana1.phone,
        templateType: 'WELCOME_ANAMNESIS',
        status: 'SENT',
        channel: 'WHATSAPP',
      },
      {
        tenantId: tenantVivi.id,
        recipientPhone: adriana.phone,
        templateType: 'WORKOUT_REMINDER',
        status: 'SENT',
        channel: 'WHATSAPP',
      },
      {
        tenantId: tenantVivi.id,
        recipientPhone: cassia.phone,
        templateType: 'PAYMENT_REMINDER',
        status: 'QUEUED',
        channel: 'WHATSAPP',
      },
    ],
  });
  console.log('✅ Notification Logs de WhatsApp registrados');

  console.log('🎉 [Seed] População do banco de dados concluída com sucesso!');
}

main()
  .catch((e) => {
    console.error('❌ [Seed] Erro durante o seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
