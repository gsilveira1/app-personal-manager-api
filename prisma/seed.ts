import {
  PrismaClient,
  ClientStatus,
  ClientModality,
  TenantStatus,
  WhatsappStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { addDays, subDays, setHours, setMinutes, addHours } from 'date-fns';

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
      status: TenantStatus.ACTIVE,
      primaryColor: '#10B981',
      setupCompleted: true,
      whatsappStatus: WhatsappStatus.CONNECTED,
      whatsappInstanceName: 'tenant-vivi-001',
      logoUrl: 'https://pub-r2.viviops.com/logos/vivi-logo.png',
      features: {
        maxStudents: 100,
        canUploadVideos: true,
        whatsappAlerts: true,
        aiAssistantEnabled: true,
      },
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
    update: {
      name: 'Elite Fit Studio',
      status: TenantStatus.ACTIVE,
      primaryColor: '#2563EB',
      logoUrl: 'https://pub-r2.viviops.com/logos/elite-logo.png',
      whatsappInstanceName: 'tenant-elite-002',
      whatsappStatus: WhatsappStatus.CONNECTED,
      setupCompleted: true,
      features: {
        maxStudents: 50,
        canUploadVideos: true,
        whatsappAlerts: true,
      },
    },
    create: {
      name: 'Elite Fit Studio',
      slug: 'elite-fit-studio',
      status: TenantStatus.ACTIVE,
      primaryColor: '#2563EB',
      logoUrl: 'https://pub-r2.viviops.com/logos/elite-logo.png',
      whatsappInstanceName: 'tenant-elite-002',
      whatsappStatus: WhatsappStatus.CONNECTED,
      setupCompleted: true,
      features: {
        maxStudents: 50,
        canUploadVideos: true,
        whatsappAlerts: true,
      },
    },
  });

  const tenantZen = await prisma.tenant.upsert({
    where: { slug: 'zen-pilates-studio' },
    update: {
      name: 'Zen Pilates & Posture',
      status: TenantStatus.OVERDUE,
      primaryColor: '#8B5CF6',
      logoUrl: 'https://pub-r2.viviops.com/logos/zen-logo.png',
      whatsappInstanceName: 'tenant-zen-003',
      whatsappStatus: WhatsappStatus.PENDING,
      setupCompleted: false,
      features: {
        maxStudents: 20,
        canUploadVideos: false,
        whatsappAlerts: false,
      },
    },
    create: {
      name: 'Zen Pilates & Posture',
      slug: 'zen-pilates-studio',
      status: TenantStatus.OVERDUE,
      primaryColor: '#8B5CF6',
      logoUrl: 'https://pub-r2.viviops.com/logos/zen-logo.png',
      whatsappInstanceName: 'tenant-zen-003',
      whatsappStatus: WhatsappStatus.PENDING,
      setupCompleted: false,
      features: {
        maxStudents: 20,
        canUploadVideos: false,
        whatsappAlerts: false,
      },
    },
  });

  const tenantIron = await prisma.tenant.upsert({
    where: { slug: 'iron-crossfit-box' },
    update: {
      name: 'Iron CrossFit Box',
      status: TenantStatus.BLOCKED,
      primaryColor: '#EF4444',
      whatsappStatus: WhatsappStatus.DISCONNECTED,
      setupCompleted: true,
    },
    create: {
      name: 'Iron CrossFit Box',
      slug: 'iron-crossfit-box',
      status: TenantStatus.BLOCKED,
      primaryColor: '#EF4444',
      whatsappStatus: WhatsappStatus.DISCONNECTED,
      setupCompleted: true,
    },
  });
  console.log(`✅ Tenants: Vivi (${tenantVivi.id}), Elite Fit (${tenantElite.id}), Zen (${tenantZen.id}), Iron (${tenantIron.id})`);

  // ──────────────────────────────────────────
  // 2. Users (Trainers / Admin)
  // ──────────────────────────────────────────
  const passwordHash = await bcrypt.hash('admin123', 10);

  const trainerVivi = await prisma.user.upsert({
    where: { email: 'admin@gym.com' },
    update: {
      name: 'Viviana Personal',
      password: passwordHash,
      role: 'admin',
      phone: '+5551999999999',
      bio: 'Personal Trainer especialista em Hipertrofia Feminina, Reabilitação e Emagrecimento.',
      avatar: 'https://images.unsplash.com/photo-1594381898411-846e7d193883?auto=format&fit=crop&q=80&w=200',
      tenantId: tenantVivi.id,
    },
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
    update: {
      name: 'Carlos Oliveira',
      password: passwordHash,
      role: 'trainer',
      phone: '+5551988888888',
      bio: 'Treinador de Alta Performance e Biomecânica.',
      tenantId: tenantElite.id,
    },
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

  const trainerJuliana = await prisma.user.upsert({
    where: { email: 'juliana.trainer@viviops.com' },
    update: {
      name: 'Juliana Silva',
      password: passwordHash,
      role: 'trainer',
      phone: '+5551977777777',
      bio: 'Treinadora assistente especializada em Funcional e Pilates Solo.',
      tenantId: tenantVivi.id,
    },
    create: {
      name: 'Juliana Silva',
      email: 'juliana.trainer@viviops.com',
      password: passwordHash,
      role: 'trainer',
      phone: '+5551977777777',
      bio: 'Treinadora assistente especializada em Funcional e Pilates Solo.',
      tenantId: tenantVivi.id,
    },
  });
  console.log(`✅ Users: Viviana (${trainerVivi.id}), Carlos (${trainerCarlos.id}), Juliana (${trainerJuliana.id})`);

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
  await prisma.userSetting.upsert({
    where: { userId_key: { userId: trainerVivi.id, key: 'calendar_default_view' } },
    update: { value: 'timeGridWeek' },
    create: {
      userId: trainerVivi.id,
      key: 'calendar_default_view',
      value: 'timeGridWeek',
    },
  });
  await prisma.userSetting.upsert({
    where: { userId_key: { userId: trainerCarlos.id, key: 'ai_prompt' } },
    update: { value: 'Foco em progressão de carga e RPE (escala de esforço percebido).' },
    create: {
      userId: trainerCarlos.id,
      key: 'ai_prompt',
      value: 'Foco em progressão de carga e RPE (escala de esforço percebido).',
    },
  });
  console.log('✅ User Settings configuradas');

  // ──────────────────────────────────────────
  // 4. Availability Blocks (Recorrentes e Pontuais)
  // ──────────────────────────────────────────
  await prisma.availabilityBlock.deleteMany({
    where: { userId: { in: [trainerVivi.id, trainerCarlos.id] } },
  });
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
      // Bloco pontual (sem rrule)
      {
        userId: trainerVivi.id,
        title: 'Consulta Médica',
        rrule: null,
        timezone: 'America/Sao_Paulo',
        dtstart: setMinutes(setHours(addDays(today, 3), 14), 0),
        dtend: setMinutes(setHours(addDays(today, 3), 16), 0),
        notes: 'Exames de rotina',
      },
      {
        userId: trainerCarlos.id,
        title: 'Manutenção Equipamentos',
        rrule: null,
        timezone: 'America/Sao_Paulo',
        dtstart: setMinutes(setHours(addDays(today, 5), 8), 0),
        dtend: setMinutes(setHours(addDays(today, 5), 11), 0),
        notes: 'Revisão das máquinas do estúdio',
      },
    ],
  });
  console.log('✅ Availability Blocks criados (recorrentes e pontuais)');

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
  const featPosture = await prisma.systemFeature.upsert({
    where: { key: 'posture_correction' },
    update: {},
    create: {
      key: 'posture_correction',
      name: 'Módulo de Avaliação Postural',
      description: 'Gera relatório de desvios posturais e assimetrias.',
      isActive: true,
    },
  });
  const featMetrics = await prisma.systemFeature.upsert({
    where: { key: 'advanced_metrics' },
    update: {},
    create: {
      key: 'advanced_metrics',
      name: 'Métricas Avançadas de Carga (1RM & Volume Load)',
      description: 'Dashboard com gráficos de tonelagem e progressão.',
      isActive: true,
    },
  });
  console.log('✅ System Features configuradas');

  // ──────────────────────────────────────────
  // 6. Plans (Planos Presenciais e Consultoria)
  // ──────────────────────────────────────────
  const [p2x30, p3x30, p4x60, p3x60, cBasica, cCompleta, cTrimestral] = await Promise.all([
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 2x 30min', sessionsPerWeek: 2, durationMinutes: 30, price: 350 }),
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 3x 30min', sessionsPerWeek: 3, durationMinutes: 30, price: 450 }),
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 4x 60min', sessionsPerWeek: 4, durationMinutes: 60, price: 650 }),
    upsertPlan(trainerVivi.id, { type: 'PRESENCIAL', name: 'Presencial 3x 60min', sessionsPerWeek: 3, durationMinutes: 60, price: 550 }),
    upsertPlan(trainerVivi.id, { type: 'CONSULTORIA', name: 'Consultoria Básica Online', sessionsPerWeek: 1, price: 180 }),
    upsertPlan(trainerVivi.id, { type: 'CONSULTORIA', name: 'Consultoria Completa Online', sessionsPerWeek: 2, price: 280 }),
    upsertPlan(trainerCarlos.id, { type: 'CONSULTORIA', name: 'Consultoria Powerlifting Trimestral', sessionsPerWeek: 2, price: 500 }),
  ]);

  // Vincular features aos planos
  await prisma.planFeature.deleteMany({
    where: { planId: { in: [cCompleta.id, p4x60.id, cBasica.id, cTrimestral.id] } },
  });
  await prisma.planFeature.createMany({
    data: [
      { planId: cCompleta.id, featureId: featAi.id },
      { planId: cCompleta.id, featureId: featVideo.id },
      { planId: p4x60.id, featureId: featPix.id },
      { planId: p4x60.id, featureId: featPosture.id },
      { planId: cTrimestral.id, featureId: featMetrics.id },
      { planId: cTrimestral.id, featureId: featVideo.id },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Planos e PlanFeatures criados');

  // ──────────────────────────────────────────
  // 7. Exercise Library (Standard & Custom)
  // ──────────────────────────────────────────
  // Limpar exercícios e relações dependentes
  await prisma.workoutExercise.deleteMany({});
  await prisma.workoutBlock.deleteMany({});
  await prisma.workoutSheetItem.deleteMany({});
  await prisma.workoutSheet.deleteMany({});
  await prisma.exercise.deleteMany({});

  const standardExercisesData = [
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

  const customExercisesData = [
    {
      name: 'Agachamento Búlgaro com Halteres e Isometria',
      bodyPart: 'Pernas',
      targetMuscle: 'Glúteo Máximo e Quadríceps',
      equipment: 'Halteres',
      gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300',
      videoUrl: 'https://pub-r2.viviops.com/videos/bulgarian-squat-vivi.mp4',
      isCustom: true,
      userId: trainerVivi.id,
      tenantId: tenantVivi.id,
    },
    {
      name: 'Face Pull com Rotação Externa no Cabo',
      bodyPart: 'Ombros',
      targetMuscle: 'Manguito Rotador / Deltoide Posterior',
      equipment: 'Polia',
      gifUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=300',
      videoUrl: 'https://pub-r2.viviops.com/videos/facepull-carlos.mp4',
      isCustom: true,
      userId: trainerCarlos.id,
      tenantId: tenantElite.id,
    },
  ];

  const createdExercises = await Promise.all([
    ...standardExercisesData.map((ex) =>
      prisma.exercise.create({
        data: {
          ...ex,
          isCustom: false,
          userId: trainerVivi.id,
          tenantId: tenantVivi.id,
        },
      }),
    ),
    ...customExercisesData.map((ex) =>
      prisma.exercise.create({
        data: ex,
      }),
    ),
  ]);
  console.log(`✅ Exercícios: ${createdExercises.length} cadastrados (padrão e customizados)`);

  // ──────────────────────────────────────────
  // 8. 20 Clientes com status e modalidades diversas
  // ──────────────────────────────────────────
  const clientsData = [
    {
      name: 'Ana Luísa Timmen',
      phone: '+5551991849376',
      email: 'ana.timmen@viviops.client',
      dateOfBirth: new Date('2009-09-24'),
      goal: 'Manter massa magra e emagrecer',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p2x30.id,
      currentPeriodEnd: addDays(today, 25),
      checkInFreq: '2x/semana',
      notes: 'Aluna muito dedicada. Preferência por treinos matinais.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Adriana Parada',
      phone: '+5551992641343',
      email: 'adriana.parada@viviops.client',
      dateOfBirth: new Date('1988-09-30'),
      goal: 'Emagrecimento e ganho de força',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p2x30.id,
      currentPeriodEnd: addDays(today, 15),
      checkInFreq: '2x/semana',
      notes: 'Histórico de dor lombar; evitar flexão de tronco excessiva.',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Angélica Eltz',
      phone: '+5551991286543',
      email: 'angelica.eltz@viviops.client',
      dateOfBirth: new Date('1969-08-03'),
      goal: 'Emagrecer e manter massa magra na menopausa',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p3x30.id,
      currentPeriodEnd: addDays(today, 20),
      checkInFreq: '3x/semana',
      notes: 'Foco em fortalecimento ósseo e muscular.',
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cássia Franck Ferreira',
      phone: '+5551981760721',
      email: 'cassia.franck@viviops.client',
      dateOfBirth: new Date('1992-06-01'),
      goal: 'Emagrecer com saúde e hipertrofia de glúteos',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p3x30.id,
      currentPeriodEnd: addDays(today, 18),
      notes: 'Advogada, rotina corrida. Treinos objetivos e intensos.',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cristiane Veridiana Martin',
      phone: '+5551991313787',
      email: 'cristiane.martin@viviops.client',
      dateOfBirth: new Date('1975-07-29'),
      goal: 'Emagrecer e manter massa magra',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p2x30.id,
      currentPeriodEnd: addDays(today, 12),
      notes: 'Excelente consistência nas terças e quintas.',
      avatar: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Cristiane Adam Grings',
      phone: '+5551991050808',
      email: 'cristiane.grings@viviops.client',
      dateOfBirth: new Date('1982-11-14'),
      goal: 'Emagrecer, manter massa magra, melhorar lipedema',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p4x60.id,
      currentPeriodEnd: addDays(today, 28),
      notes: 'Treina 4 vezes na semana. Carga progressiva.',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Gabriela Silveira',
      phone: '+5551994433221',
      email: 'gabriela.silveira@viviops.client',
      dateOfBirth: new Date('1993-03-22'),
      goal: 'Preparação para corrida e força',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.ONLINE,
      status: ClientStatus.ACTIVE,
      planId: cCompleta.id,
      currentPeriodEnd: addDays(today, 30),
      notes: 'Utiliza o PWA para executar os treinos e registrar cargas.',
      avatar: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Mariana Duarte',
      phone: '+5551992211009',
      email: 'mariana.duarte@viviops.client',
      dateOfBirth: new Date('1987-09-08'),
      goal: 'Consultoria online - Treino em casa com halteres',
      modality: ClientModality.ONLINE,
      status: ClientStatus.PAUSED,
      planId: cCompleta.id,
      currentPeriodEnd: subDays(today, 5),
      notes: 'Plano pausado por 30 dias após procedimento cirúrgico no joelho.',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Rodrigo Mendes',
      phone: '+5551991100998',
      email: 'rodrigo.mendes@viviops.client',
      dateOfBirth: new Date('1984-02-17'),
      goal: 'Ganho de massa magra e postura',
      modality: ClientModality.ONLINE,
      status: ClientStatus.OVERDUE,
      planId: cBasica.id,
      currentPeriodEnd: subDays(today, 8),
      notes: 'Mensalidade pendente de renovação. Lembrete enviado via WhatsApp.',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Thiago Albuquerque',
      phone: '+5551990099887',
      email: 'thiago.albuquerque@viviops.client',
      dateOfBirth: new Date('1989-08-30'),
      goal: 'Performance e Hipertrofia',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.HYBRID,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.HYBRID,
      status: ClientStatus.ACTIVE,
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
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      planId: p3x30.id,
      notes: 'Aluna assídua há mais de 1 ano.',
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200',
    },
    {
      name: 'Fernanda Souza Lead',
      phone: '+5551986655443',
      email: 'fernanda.souza.lead@viviops.client',
      dateOfBirth: new Date('1998-04-20'),
      goal: 'Emagrecimento e consultoria inicial',
      modality: ClientModality.ONLINE,
      status: ClientStatus.LEAD,
      planId: null,
      notes: 'Lead captado via formulário do Instagram. Enviado link de anamnese.',
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
        planId: c.planId,
        currentPeriodEnd: c.currentPeriodEnd,
        checkInFreq: c.checkInFreq,
        notes: c.notes,
        avatar: c.avatar,
        dateOfBirth: c.dateOfBirth,
        userId: trainerVivi.id,
        tenantId: tenantVivi.id,
      },
      create: {
        ...c,
        userId: trainerVivi.id,
        tenantId: tenantVivi.id,
      },
    });
    createdClients.push(client);
  }
  console.log(`✅ 20 Clientes cadastrados e vinculados ao Tenant Vivi (Vivi Personal Studio)!`);

  // Clientes específicos do Tenant Elite Fit (Carlos)
  const carlosClientsData = [
    {
      name: 'Bruno Meirelles',
      email: 'bruno.meirelles@elitefit.client',
      phone: '+5551981112233',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.ACTIVE,
      goal: 'Hipertrofia e Powerlifting',
      planId: cTrimestral.id,
      userId: trainerCarlos.id,
      tenantId: tenantElite.id,
    },
    {
      name: 'Camila Peixoto',
      email: 'camila.peixoto@elitefit.client',
      phone: '+5551982223344',
      modality: ClientModality.ONLINE,
      status: ClientStatus.ACTIVE,
      goal: 'Consultoria de Corrida e Resistência',
      planId: cTrimestral.id,
      userId: trainerCarlos.id,
      tenantId: tenantElite.id,
    },
    {
      name: 'Marcos Vinicius Lead',
      email: 'marcos.lead@elitefit.client',
      phone: '+5551983334455',
      modality: ClientModality.PRESENCIAL,
      status: ClientStatus.LEAD,
      goal: 'Preparação para teste de aptidão física (TAF)',
      userId: trainerCarlos.id,
      tenantId: tenantElite.id,
    },
  ];

  const createdCarlosClients = [];
  for (const cc of carlosClientsData) {
    const c = await prisma.client.upsert({
      where: { email: cc.email },
      update: {
        name: cc.name,
        phone: cc.phone,
        goal: cc.goal,
        modality: cc.modality,
        status: cc.status,
        planId: cc.planId,
        userId: cc.userId,
        tenantId: cc.tenantId,
      },
      create: cc,
    });
    createdCarlosClients.push(c);
  }
  console.log(`✅ Clientes adicionais vinculados ao Tenant Elite Fit (${tenantElite.name})!`);

  // ──────────────────────────────────────────
  // 9. Anamneses e Reavaliações Físicas
  // ──────────────────────────────────────────
  const ana1 = createdClients[0];
  const adriana = createdClients[1];
  const cassia = createdClients[3];
  const juliana = createdClients[10];
  const leticia = createdClients[12];
  const leadFernanda = createdClients[19];

  await prisma.anamnesis.deleteMany({
    where: { userId: { in: [trainerVivi.id, trainerCarlos.id] } },
  });
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
        measurements: { waist: 68, hips: 98, chest: 88, rightArm: 26, rightThigh: 54 },
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
        measurements: { waist: 74, hips: 102, chest: 92, rightArm: 28, rightThigh: 58 },
      },
      {
        clientId: cassia.id,
        userId: trainerVivi.id,
        isCurrent: true,
        token: 'token-anamnese-cassia-003',
        tokenUsed: true,
        medicalHistory: 'Nenhum problema de saúde crônico.',
        injuriesAndPain: 'Nenhuma lesão relatada.',
        routineAndSchedule: 'Rotina de advocacia, noites livres.',
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
        injuriesAndPain: 'Leve estalo indolor no ombro direito.',
        routineAndSchedule: 'Tardes livres das 17h às 19h.',
        fitnessGoals: 'Hipertrofia máxima e ganho de força.',
        experienceLevel: 'Avançado',
        weightKg: 67.5,
      },
      // Anamnese pendente para Lead
      {
        clientId: leadFernanda.id,
        userId: trainerVivi.id,
        isCurrent: false,
        token: 'token-lead-fernanda-999',
        tokenUsed: false,
        medicalHistory: null,
        injuriesAndPain: null,
        routineAndSchedule: null,
        fitnessGoals: 'Perder 5kg antes do verão',
        experienceLevel: 'Iniciante',
      },
    ],
  });
  console.log('✅ Anamneses cadastradas (respondidas e pendentes)');

  // ──────────────────────────────────────────
  // 10. Avaliações Físicas e Dobras Cutâneas
  // ──────────────────────────────────────────
  const allClientIds = [...createdClients, ...createdCarlosClients].map((c) => c.id);
  await prisma.evaluation.deleteMany({ where: { clientId: { in: allClientIds } } });
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
        bodyDensity: 1.045,
        protocol: 'POLLOCK_3',
        equation: 'Siri',
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
        bodyDensity: 1.052,
        protocol: 'POLLOCK_3',
        equation: 'Siri',
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
        bodyDensity: 1.061,
        protocol: 'POLLOCK_7',
        equation: 'Siri',
        skinfolds: { triceps: 10, subscapular: 11, pectoral: 8, axillary: 9, suprailiac: 10, abdominal: 12, thigh: 14 },
        perimeters: { waist: 66, abdomen: 72, hips: 102, rightThigh: 59, rightArm: 30 },
        notes: 'Composição corporal atleta. Foco em volume de deltoides e posteriores.',
      },
      {
        clientId: leticia.id,
        date: subDays(today, 15),
        weight: 56.0,
        height: 162,
        bodyFatPercentage: 22.0,
        leanMass: 43.68,
        fatMass: 12.32,
        protocol: 'POLLOCK_3',
        skinfolds: { triceps: 11, suprailiac: 12, thigh: 16 },
        perimeters: { waist: 64, hips: 94, rightThigh: 52, rightArm: 25 },
        notes: 'Avaliação trimestral da consultoria online.',
      },
    ],
  });
  console.log('✅ Avaliações Físicas cadastradas');

  // ──────────────────────────────────────────
  // 11. Templates de Treino & Fichas A/B/C
  // ──────────────────────────────────────────
  await prisma.workoutTemplate.deleteMany({
    where: { userId: { in: [trainerVivi.id, trainerCarlos.id] } },
  });
  await prisma.workoutTemplate.createMany({
    data: [
      {
        userId: trainerVivi.id,
        name: 'Hipertrofia Feminina A/B/C',
        description: 'Divisão A (Inferiores foco Quadríceps), B (Superiores + Core), C (Glúteos e Posterior).',
        structure: {
          days: ['A', 'B', 'C'],
          focus: 'Glúteos, Quadríceps e Dorsais',
          targetAudience: 'Feminino Intermediário/Avançado',
        },
      },
      {
        userId: trainerVivi.id,
        name: 'Emagrecimento Full Body 30min',
        description: 'Treino metabólico em circuito com blocos Bi-Set.',
        structure: {
          duration: 30,
          type: 'Bi-Set Circuit',
          circuits: 3,
        },
      },
      {
        userId: trainerCarlos.id,
        name: 'Powerlifting Base Linear 5x5',
        description: 'Foco em força pura: Agachamento, Supino e Levantamento Terra.',
        structure: {
          frequency: '3x/semana',
          rpeTarget: '8-9',
          sets: 5,
          reps: 5,
        },
      },
    ],
  });
  console.log('✅ Templates de Treino cadastrados');

  // Criar WorkoutSheet para Ana Luísa, Juliana e Letícia
  const exMap = new Map(createdExercises.map((e) => [e.name, e.id]));

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
                        exerciseId: exMap.get('Agachamento Livre'),
                        exerciseName: 'Agachamento Livre',
                        gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300',
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
                        exerciseId: exMap.get('Leg Press 45º'),
                        exerciseName: 'Leg Press 45º',
                        gifUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300',
                        sets: 3,
                        reps: '12-15',
                        suggestedLoadKg: 80,
                        orderIndex: 0,
                      },
                      {
                        exerciseId: exMap.get('Cadeira Extensora'),
                        exerciseName: 'Cadeira Extensora',
                        gifUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=300',
                        sets: 3,
                        reps: '12-15 com pico de 2s',
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
                        exerciseId: exMap.get('Elevação Pélvica com Barra'),
                        exerciseName: 'Elevação Pélvica com Barra',
                        gifUrl: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=300',
                        sets: 4,
                        reps: '10-12',
                        suggestedLoadKg: 60,
                        executionNotes: 'Segurar 2 segundos em cima com contração máxima.',
                        orderIndex: 0,
                      },
                    ],
                  },
                },
                {
                  type: 'TRISET',
                  orderIndex: 1,
                  restTimeSeconds: 60,
                  exercises: {
                    create: [
                      {
                        exerciseId: exMap.get('Puxada Alta Frontal'),
                        exerciseName: 'Puxada Alta Frontal',
                        sets: 3,
                        reps: '10-12',
                        suggestedLoadKg: 35,
                        orderIndex: 0,
                      },
                      {
                        exerciseId: exMap.get('Remada Baixa no Triângulo'),
                        exerciseName: 'Remada Baixa no Triângulo',
                        sets: 3,
                        reps: '10-12',
                        suggestedLoadKg: 30,
                        orderIndex: 1,
                      },
                      {
                        exerciseId: exMap.get('Prancha Abdominal Isométrica'),
                        exerciseName: 'Prancha Abdominal Isométrica',
                        sets: 3,
                        reps: '45s',
                        orderIndex: 2,
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
    include: {
      workouts: {
        include: {
          blocks: {
            include: {
              exercises: true,
            },
          },
        },
      },
    },
  });

  const sheetLeticia = await prisma.workoutSheet.create({
    data: {
      userId: trainerVivi.id,
      clientId: leticia.id,
      name: 'Consultoria Online - Ficha Condomínio',
      active: true,
      expiresAt: addDays(today, 60),
      workouts: {
        create: [
          {
            letter: 'A',
            name: 'Full Body A - Ênfase Inferiores',
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
                        exerciseId: exMap.get('Agachamento Búlgaro com Halteres e Isometria'),
                        exerciseName: 'Agachamento Búlgaro com Halteres e Isometria',
                        sets: 3,
                        reps: '10 cada perna',
                        suggestedLoadKg: 10,
                        executionNotes: 'Assistir ao vídeo customizado anexado antes da execução.',
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
    include: {
      workouts: true,
    },
  });

  console.log(`✅ Workout Sheets criadas (Ana: ${sheetAna.id}, Letícia: ${sheetLeticia.id})`);

  // ──────────────────────────────────────────
  // 12. Student Sessions & Logs de Treino (Heatmap Data)
  // ──────────────────────────────────────────
  await prisma.studentSession.deleteMany({ where: { clientId: { in: allClientIds } } });
  const studentSessionLogs = [];
  // Gera 20 sessões concluídas no último mês para alimentar o Heatmap
  for (let i = 1; i <= 24; i += 2) {
    studentSessionLogs.push({
      clientId: ana1.id,
      workoutId: sheetAna.workouts[0]?.id,
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
    studentSessionLogs.push({
      clientId: leticia.id,
      workoutId: sheetLeticia.workouts[0]?.id,
      workoutName: 'Full Body A - Ênfase Inferiores',
      durationSeconds: 2400,
      completedAt: subDays(today, i),
      loads: {
        'Agachamento Búlgaro com Halteres e Isometria': [10, 12, 12],
      },
    });
  }
  await prisma.studentSession.createMany({ data: studentSessionLogs });
  console.log(`✅ ${studentSessionLogs.length} Student Sessions geradas para Heatmap`);

  // ──────────────────────────────────────────
  // 13. Agendamentos: Sessões e Eventos Recorrentes (RFC 5545)
  // ──────────────────────────────────────────
  await prisma.session.deleteMany({
    where: { userId: { in: [trainerVivi.id, trainerCarlos.id] } },
  });
  await prisma.sessionException.deleteMany({});
  await prisma.recurringEvent.deleteMany({
    where: { userId: { in: [trainerVivi.id, trainerCarlos.id] } },
  });

  // Sessões avulsas passadas e futuras
  await prisma.session.createMany({
    data: [
      {
        userId: trainerVivi.id,
        clientId: ana1.id,
        linkedWorkoutId: sheetAna.workouts[0]?.id,
        date: subDays(today, 2),
        durationMinutes: 30,
        type: 'In-Person',
        category: 'Workout',
        completed: true,
        cancelled: false,
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
        cancelled: false,
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
        cancelled: false,
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
        cancelled: false,
        notes: 'Sessão de 60min com teste de carga máxima.',
      },
      // Sessão cancelada
      {
        userId: trainerVivi.id,
        clientId: adriana.id,
        date: subDays(today, 7),
        durationMinutes: 30,
        type: 'In-Person',
        category: 'Workout',
        completed: false,
        cancelled: true,
        notes: 'Cancelado pelo aluno com aviso prévio.',
      },
      // Sessão de Avaliação
      {
        userId: trainerVivi.id,
        clientId: leticia.id,
        date: subDays(today, 15),
        durationMinutes: 45,
        type: 'Online',
        category: 'Evaluation',
        completed: true,
        cancelled: false,
        notes: 'Reavaliação física e ajuste de planilha trimestral.',
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
      linkedWorkoutId: sheetAna.workouts[0]?.id,
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

  // Exceções de Sessão Recorrente (SessionException)
  // 1. Cancelamento
  await prisma.sessionException.create({
    data: {
      recurringEventId: recAna.id,
      originalStartTime: setMinutes(setHours(addDays(today, 7), 8), 0),
      cancelled: true,
      completed: false,
      notes: 'Cancelado a pedido da aluna para consulta médica.',
    },
  });

  // 2. Reagendamento com novo horário
  await prisma.sessionException.create({
    data: {
      recurringEventId: recJuliana.id,
      originalStartTime: setMinutes(setHours(addDays(today, 2), 17), 0),
      cancelled: false,
      newStartTime: setMinutes(setHours(addDays(today, 2), 18), 30),
      durationMinutes: 45,
      completed: false,
      notes: 'Horário ajustado para 18:30 devido a reunião de trabalho.',
    },
  });

  // 3. Exceção com conclusão realizada
  await prisma.sessionException.create({
    data: {
      recurringEventId: recAna.id,
      originalStartTime: setMinutes(setHours(subDays(today, 5), 8), 0),
      cancelled: false,
      newStartTime: setMinutes(setHours(subDays(today, 5), 7), 30),
      durationMinutes: 30,
      completed: true,
      notes: 'Adiantado para 07:30 e realizado com sucesso.',
    },
  });
  console.log('✅ Sessões pontuais, Eventos Recorrentes (RRULE) e Exceções configurados');

  // ──────────────────────────────────────────
  // 14. Pagamentos Manuais (ManualPayment)
  // ──────────────────────────────────────────
  await prisma.manualPayment.deleteMany({
    where: { userId: { in: [trainerVivi.id, trainerCarlos.id] } },
  });
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
      {
        userId: trainerVivi.id,
        clientId: leticia.id,
        paymentType: 'MANUAL_CARD',
        amount: 280.0,
        validUntil: addDays(today, 30),
        notes: 'Passado na máquina de cartão do estúdio (crédito à vista).',
      },
      {
        userId: trainerCarlos.id,
        clientId: createdCarlosClients[0].id,
        paymentType: 'MANUAL_PIX',
        amount: 500.0,
        validUntil: addDays(today, 90),
        notes: 'Trimestral pago via PIX com comprovante anexo.',
      },
    ],
  });
  console.log('✅ Pagamentos Manuais registrados (PIX, CASH, CARD)');

  // ──────────────────────────────────────────
  // 15. Notification Logs (WhatsApp & Email Queues)
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
      {
        tenantId: tenantVivi.id,
        recipientPhone: '+5551900000000',
        templateType: 'WORKOUT_REMINDER',
        status: 'FAILED',
        channel: 'WHATSAPP',
        error: 'Número de telefone inválido ou não registrado na rede WhatsApp.',
      },
      {
        tenantId: tenantVivi.id,
        recipientPhone: leticia.email,
        templateType: 'WORKOUT_SHEET_UPDATED',
        status: 'SENT',
        channel: 'EMAIL',
      },
      {
        tenantId: tenantElite.id,
        recipientPhone: 'bounce@invalid-mail.com',
        templateType: 'PAYMENT_REMINDER',
        status: 'FAILED',
        channel: 'EMAIL',
        error: '550 5.1.1 User unknown / Mailbox does not exist.',
      },
    ],
  });
  console.log('✅ Notification Logs (WhatsApp e Email) registrados');

  // ──────────────────────────────────────────
  // 16. Password Reset Tokens
  // ──────────────────────────────────────────
  await prisma.passwordResetToken.deleteMany({});
  await prisma.passwordResetToken.createMany({
    data: [
      // Token ativo e válido
      {
        userId: trainerVivi.id,
        token: 'active-reset-token-vivi-123456',
        expiresAt: addHours(today, 2),
        used: false,
      },
      // Token já utilizado
      {
        userId: trainerCarlos.id,
        token: 'used-reset-token-carlos-789012',
        expiresAt: subDays(today, 1),
        used: true,
      },
      // Token expirado sem uso
      {
        userId: trainerJuliana.id,
        token: 'expired-reset-token-juliana-345678',
        expiresAt: subDays(today, 3),
        used: false,
      },
    ],
  });
  console.log('✅ Password Reset Tokens criados (ativo, usado, expirado)');

  // ──────────────────────────────────────────
  // 17. Verificação de Cobertura de Todas as 23 Entidades
  // ──────────────────────────────────────────
  const counts = {
    Tenants: await prisma.tenant.count(),
    Users: await prisma.user.count(),
    Clients: await prisma.client.count(),
    Plans: await prisma.plan.count(),
    SystemFeatures: await prisma.systemFeature.count(),
    PlanFeatures: await prisma.planFeature.count(),
    Sessions: await prisma.session.count(),
    Evaluations: await prisma.evaluation.count(),
    UserSettings: await prisma.userSetting.count(),
    RecurringEvents: await prisma.recurringEvent.count(),
    SessionExceptions: await prisma.sessionException.count(),
    AvailabilityBlocks: await prisma.availabilityBlock.count(),
    ManualPayments: await prisma.manualPayment.count(),
    Anamneses: await prisma.anamnesis.count(),
    Exercises: await prisma.exercise.count(),
    WorkoutSheets: await prisma.workoutSheet.count(),
    WorkoutSheetItems: await prisma.workoutSheetItem.count(),
    WorkoutBlocks: await prisma.workoutBlock.count(),
    WorkoutExercises: await prisma.workoutExercise.count(),
    WorkoutTemplates: await prisma.workoutTemplate.count(),
    StudentSessions: await prisma.studentSession.count(),
    NotificationLogs: await prisma.notificationLog.count(),
    PasswordResetTokens: await prisma.passwordResetToken.count(),
  };

  console.log('\n📊 [Seed] Resumo de registros cadastrados no banco de dados:');
  console.table(counts);

  const emptyEntities = Object.entries(counts).filter(([_, count]) => count === 0);
  if (emptyEntities.length > 0) {
    throw new Error(
      `❌ [Seed] Falha na cobertura: as seguintes entidades estão vazias: ${emptyEntities.map(([name]) => name).join(', ')}`,
    );
  }

  console.log('🎉 [Seed] População de todas as 23 entidades concluída com 100% de cobertura e sucesso!');
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
