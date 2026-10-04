/**
 * Demo data for the consolidated schema (docs/api-contract-v2.md, 11 models).
 *
 * Idempotent: accounts are created when their e-mail is missing (an existing
 * account is never overwritten: its password, role and status stay as they are),
 * global exercises are upserted by id, and everything the demo trainers own is
 * deleted and recreated, so running it twice leaves the same rows. Data of any
 * other account is never touched.
 *
 * Production: refuses to run with NODE_ENV=production unless
 * SEED_ALLOW_PRODUCTION=true, and then requires SEED_ADMIN_PASSWORD (no default).
 * See prisma/seed-guard.ts.
 *
 * Every JSONB column is written through the builder of src/common/types
 * (a hand-built document makes the API answer 500 on read, by design).
 *
 * Run: npx prisma db seed   (DATABASE_URL must point at the target database)
 */
import "reflect-metadata";
import {
  AccountStatus,
  AssessmentType,
  ClientModality,
  ClientStatus,
  EventStatus,
  EventType,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
  WhatsappStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcrypt";
import { addDays, subDays } from "date-fns";
import { Pool } from "pg";
import { v5 as uuidv5 } from "uuid";

import {
  buildAnamnesisData,
  buildExecutionData,
  buildIdempotencyKey,
  buildPhysicalEvaluationData,
  buildWorkoutStructure,
  EMPTY_ANAMNESIS_DATA,
  mergeUserSettings,
  PlanFeatureKey,
  toJsonValue,
  UserSettings,
  WorkoutStructureInputDto,
} from "../src/common/types";
import { expandRRuleForRange } from "../src/modules/calendar/rrule-expander";
import {
  assertSeedAllowed,
  DEMO_PASSWORD,
  resolveSeedPassword,
  ScriptEnv,
} from "./seed-guard";

export interface SeedConnection {
  prisma: PrismaClient;
  close: () => Promise<void>;
}

function connectTo(databaseUrl: string): SeedConnection {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma: client,
    close: async () => {
      await client.$disconnect();
      await pool.end();
    },
  };
}

/** Set by main() once the production guard has passed; nothing connects before that. */
let prisma: PrismaClient;

const SEED_NAMESPACE = "6f1d1c9e-5a1f-4c0e-9a55-0b6c7d1e2f30";
const TIMEZONE = "America/Sao_Paulo";
const PHOTO = "https://images.unsplash.com";
const CDN = "https://pub-r2.viviops.com";

/** Stable UUID for a seeded row, so re-runs and cross-references agree. */
const seedId = (name: string): string => uuidv5(name, SEED_NAMESPACE);

/** `days` from today at hh:mm (server local time), seconds zeroed (RRULE instants are whole seconds). */
function at(days: number, hours: number, minutes = 0): Date {
  const date = addDays(new Date(), days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

const settings = (patch: UserSettings): Prisma.InputJsonValue =>
  toJsonValue(mergeUserSettings({}, patch));

// ─── 1. Accounts ─────────────────────────────────────────────────────────────

interface AccountSeed {
  email: string;
  name: string;
  role: "admin" | "trainer";
  slug: string;
  status: AccountStatus;
  primaryColor: string;
  logoUrl: string | null;
  setupCompleted: boolean;
  phone: string | null;
  bio: string | null;
  settings: UserSettings;
}

const ACCOUNTS: AccountSeed[] = [
  {
    // The only admin: sign-up can create trainers only.
    email: "admin@gym.com",
    name: "Viviana Personal",
    role: "admin",
    slug: "vivi-personal",
    status: AccountStatus.ACTIVE,
    primaryColor: "#10B981",
    logoUrl: `${CDN}/logos/vivi-logo.png`,
    setupCompleted: true,
    phone: "+5553999990001",
    bio: "Personal trainer em Pelotas/RS. Treinos presenciais de 30 e 60 minutos e consultoria online.",
    settings: {
      aiInstructions:
        "Priorize cadência 3-0-1-0 e foco em amplitude máxima para alunos com queixas posturais.",
      language: "pt-BR",
      limits: { maxStudents: 100, canUploadVideos: true, whatsappAlerts: true },
    },
  },
  {
    email: "carlos@elitefit.com",
    name: "Carlos Oliveira",
    role: "trainer",
    slug: "elite-fit-studio",
    status: AccountStatus.ACTIVE,
    primaryColor: "#2563EB",
    logoUrl: `${CDN}/logos/elite-logo.png`,
    setupCompleted: true,
    phone: "+5551999990002",
    bio: "Powerlifting e condicionamento.",
    settings: {
      aiInstructions:
        "Foco em progressão de carga e RPE (escala de esforço percebido).",
      limits: { maxStudents: 50, canUploadVideos: true, whatsappAlerts: true },
    },
  },
  {
    email: "juliana.trainer@viviops.com",
    name: "Juliana Silva",
    role: "trainer",
    slug: "zen-pilates-studio",
    status: AccountStatus.OVERDUE,
    primaryColor: "#8B5CF6",
    logoUrl: `${CDN}/logos/zen-logo.png`,
    setupCompleted: false,
    phone: null,
    bio: null,
    settings: {
      limits: {
        maxStudents: 20,
        canUploadVideos: false,
        whatsappAlerts: false,
      },
    },
  },
  {
    email: "rafael@ironcrossfit.com",
    name: "Rafael Iron CrossFit",
    role: "trainer",
    slug: "iron-crossfit-box",
    status: AccountStatus.BLOCKED,
    primaryColor: "#DC2626",
    logoUrl: null,
    setupCompleted: false,
    phone: null,
    bio: null,
    settings: {},
  },
];

/**
 * Creates the demo accounts that are missing. An account that already exists is
 * left exactly as it is (`update: {}`): a re-run never resets a password.
 */
async function seedAccounts(
  plainPassword: string,
): Promise<Map<string, string>> {
  const password = await bcrypt.hash(plainPassword, 10);
  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) {
    // WhatsApp is seeded unpaired on purpose: a CONNECTED demo account next to a
    // configured Evolution API would send real messages to the demo phone numbers.
    const data = {
      ...account,
      settings: settings(account.settings),
      password,
      whatsappInstanceName: null,
      whatsappStatus: WhatsappStatus.DISCONNECTED,
    };
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: data,
    });
    ids.set(account.slug, user.id);
  }
  return ids;
}

/** Removes everything the demo trainers own; clients cascade to their payments, sheets, events, assessments and sessions. */
async function clearOwnedData(userIds: string[]): Promise<void> {
  const owned = { userId: { in: userIds } };
  await prisma.$transaction([
    prisma.notificationLog.deleteMany({ where: owned }),
    prisma.event.deleteMany({ where: owned }),
    prisma.client.deleteMany({ where: owned }),
    prisma.workoutSheet.deleteMany({ where: owned }),
    prisma.plan.deleteMany({ where: owned }),
    prisma.exercise.deleteMany({ where: owned }),
    prisma.passwordResetToken.deleteMany({ where: owned }),
  ]);
}

// ─── 2. Exercises ────────────────────────────────────────────────────────────

/** The catalogue the API used to hard-code; ids are kept because stored sheets may reference them. */
const GLOBAL_EXERCISES = [
  [
    "global-bench-press",
    "Barbell Bench Press",
    "chest",
    "pectorals",
    "barbell",
    "bench-press",
  ],
  [
    "global-squat",
    "Barbell Back Squat",
    "legs",
    "quadriceps",
    "barbell",
    "squat",
  ],
  [
    "global-deadlift",
    "Barbell Deadlift",
    "back",
    "erector spinae",
    "barbell",
    "deadlift",
  ],
  [
    "global-pullup",
    "Pull Up",
    "back",
    "latissimus dorsi",
    "bodyweight",
    "pull-up",
  ],
  [
    "global-dumbell-curl",
    "Dumbbell Bicep Curl",
    "arms",
    "biceps",
    "dumbbell",
    "dumbbell-curl",
  ],
  [
    "global-tricep-pushdown",
    "Tricep Pushdown",
    "arms",
    "triceps",
    "cable",
    "tricep-pushdown",
  ],
  [
    "global-shoulder-press",
    "Dumbbell Shoulder Press",
    "shoulders",
    "deltoids",
    "dumbbell",
    "shoulder-press",
  ],
  [
    "global-leg-press",
    "Leg Press",
    "legs",
    "quadriceps",
    "machine",
    "leg-press",
  ],
] as const;

async function seedExercises(viviId: string, carlosId: string): Promise<void> {
  for (const [
    id,
    name,
    bodyPart,
    targetMuscle,
    equipment,
    gif,
  ] of GLOBAL_EXERCISES) {
    const data = {
      name,
      bodyPart,
      targetMuscle,
      equipment,
      gifUrl: `https://pub-r2.com/exercises/${gif}.gif`,
      userId: null,
    };
    await prisma.exercise.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }
  await prisma.exercise.createMany({
    data: [
      {
        id: seedId("exercise:bulgarian"),
        name: "Agachamento Búlgaro com Halteres e Isometria",
        bodyPart: "Pernas",
        targetMuscle: "Glúteo Máximo e Quadríceps",
        equipment: "Halteres",
        gifUrl: `${PHOTO}/photo-1574680096145-d05b474e2155?w=300`,
        videoUrl: `${CDN}/videos/bulgarian-squat-vivi.mp4`,
        userId: viviId,
      },
      {
        id: seedId("exercise:elevacao-pelvica"),
        name: "Elevação Pélvica com Barra",
        bodyPart: "Pernas",
        targetMuscle: "Glúteos",
        equipment: "Barra",
        userId: viviId,
      },
      {
        id: seedId("exercise:facepull"),
        name: "Face Pull com Rotação Externa no Cabo",
        bodyPart: "Ombros",
        targetMuscle: "Manguito Rotador / Deltoide Posterior",
        equipment: "Polia",
        gifUrl: `${PHOTO}/photo-1584735935682-2f2b69dff9d2?w=300`,
        videoUrl: `${CDN}/videos/facepull-carlos.mp4`,
        userId: carlosId,
      },
    ],
  });
}

// ─── 3. Plans ────────────────────────────────────────────────────────────────

type PlanKey =
  | "p2x30"
  | "p3x30"
  | "p4x60"
  | "p3x60"
  | "cBasica"
  | "cCompleta"
  | "cTrimestral";

async function seedPlans(
  viviId: string,
  carlosId: string,
): Promise<Record<PlanKey, string>> {
  const {
    AI_WHATSAPP_BOT,
    VIDEO_EXERCISE_UPLOAD,
    AUTOMATED_PIX,
    POSTURE_CORRECTION,
    ADVANCED_METRICS,
  } = PlanFeatureKey;
  const plans: Array<
    [PlanKey, string, Omit<Prisma.PlanCreateManyInput, "id" | "userId">]
  > = [
    [
      "p2x30",
      viviId,
      {
        type: "PRESENCIAL",
        name: "Presencial 2x 30min",
        sessionsPerWeek: 2,
        durationMinutes: 30,
        price: 350,
      },
    ],
    [
      "p3x30",
      viviId,
      {
        type: "PRESENCIAL",
        name: "Presencial 3x 30min",
        sessionsPerWeek: 3,
        durationMinutes: 30,
        price: 450,
      },
    ],
    [
      "p4x60",
      viviId,
      {
        type: "PRESENCIAL",
        name: "Presencial 4x 60min",
        sessionsPerWeek: 4,
        durationMinutes: 60,
        price: 650,
        features: [AUTOMATED_PIX, POSTURE_CORRECTION],
      },
    ],
    [
      "p3x60",
      viviId,
      {
        type: "PRESENCIAL",
        name: "Presencial 3x 60min",
        sessionsPerWeek: 3,
        durationMinutes: 60,
        price: 550,
      },
    ],
    [
      "cBasica",
      viviId,
      {
        type: "CONSULTORIA",
        name: "Consultoria Básica Online",
        sessionsPerWeek: 1,
        price: 180,
      },
    ],
    [
      "cCompleta",
      viviId,
      {
        type: "CONSULTORIA",
        name: "Consultoria Completa Online",
        sessionsPerWeek: 2,
        price: 280,
        features: [AI_WHATSAPP_BOT, VIDEO_EXERCISE_UPLOAD],
      },
    ],
    [
      "cTrimestral",
      carlosId,
      {
        type: "CONSULTORIA",
        name: "Consultoria Powerlifting Trimestral",
        sessionsPerWeek: 2,
        price: 500,
        features: [ADVANCED_METRICS, VIDEO_EXERCISE_UPLOAD],
      },
    ],
  ];
  await prisma.plan.createMany({
    data: plans.map(([key, userId, plan]) => ({
      id: seedId(`plan:${key}`),
      userId,
      ...plan,
    })),
  });
  return Object.fromEntries(
    plans.map(([key]) => [key, seedId(`plan:${key}`)]),
  ) as Record<PlanKey, string>;
}

// ─── 4. Clients and payments ─────────────────────────────────────────────────

interface ClientSeed {
  key: string;
  name: string;
  phone: string;
  email: string;
  born?: string;
  goal: string;
  modality: ClientModality;
  status: ClientStatus;
  plan?: PlanKey;
  /** Days until the paid period ends; set together with a PAID payment. */
  paidDays?: number;
  checkInFreq?: string;
  notes?: string;
  avatar?: string;
  deleted?: boolean;
}

const { PRESENCIAL, ONLINE, HYBRID } = ClientModality;
const { ACTIVE, PAUSED, OVERDUE, LEAD } = ClientStatus;

const VIVI_CLIENTS: ClientSeed[] = [
  {
    key: "ana",
    name: "Ana Luísa Timmen",
    phone: "+5551991849376",
    email: "ana.timmen@viviops.client",
    born: "2009-09-24",
    goal: "Manter massa magra e emagrecer",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    paidDays: 25,
    checkInFreq: "2x/semana",
    notes: "Aluna muito dedicada. Preferência por treinos matinais.",
    avatar: `${PHOTO}/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200`,
  },
  {
    key: "adriana",
    name: "Adriana Parada",
    phone: "+5551992641343",
    email: "adriana.parada@viviops.client",
    born: "1988-09-30",
    goal: "Emagrecimento e ganho de força",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    paidDays: 15,
    checkInFreq: "2x/semana",
    notes: "Histórico de dor lombar; evitar flexão de tronco excessiva.",
    avatar: `${PHOTO}/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200`,
  },
  {
    key: "angelica",
    name: "Angélica Eltz",
    phone: "+5551991286543",
    email: "angelica.eltz@viviops.client",
    born: "1969-08-03",
    goal: "Emagrecer e manter massa magra na menopausa",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p3x30",
    checkInFreq: "3x/semana",
    notes: "Foco em fortalecimento ósseo e muscular.",
  },
  {
    key: "cassia",
    name: "Cássia Franck Ferreira",
    phone: "+5551981760721",
    email: "cassia.franck@viviops.client",
    born: "1992-06-01",
    goal: "Emagrecer com saúde e hipertrofia de glúteos",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p3x30",
    paidDays: 20,
    notes: "Advogada, rotina corrida. Treinos objetivos e intensos.",
  },
  {
    key: "cristiane-martin",
    name: "Cristiane Veridiana Martin",
    phone: "+5551991313787",
    email: "cristiane.martin@viviops.client",
    born: "1975-07-29",
    goal: "Emagrecer e manter massa magra",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    notes: "Excelente consistência nas terças e quintas.",
  },
  {
    key: "cristiane-grings",
    name: "Cristiane Adam Grings",
    phone: "+5551991050808",
    email: "cristiane.grings@viviops.client",
    born: "1982-11-14",
    goal: "Emagrecer, manter massa magra, melhorar lipedema",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    notes: "Cuidado especial com retenção hídrica.",
  },
  {
    key: "cristiane-roxo",
    name: "Cristiane Roxo",
    phone: "+5551999988112",
    email: "cristiane.roxo@viviops.client",
    born: "1978-04-12",
    goal: "Tonificação e condicionamento cardiovascular",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p3x30",
    notes: "Treina sempre com a amiga Fabiane.",
  },
  {
    key: "fabiane",
    name: "Fabiane Bitencourt",
    phone: "+5551988877223",
    email: "fabiane.bitencourt@viviops.client",
    born: "1980-01-20",
    goal: "Hipertrofia de membros inferiores",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p3x30",
    notes: "Boa resposta neuromuscular.",
  },
  {
    key: "graziela",
    name: "Graziela Larruscaim",
    phone: "+5551997766334",
    email: "graziela.larruscaim@viviops.client",
    born: "1985-05-18",
    goal: "Saúde geral e mobilidade articular",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    notes: "Alongamentos e mobilidade no início do treino.",
  },
  {
    key: "grazielle",
    name: "Grazielle Pimentel",
    phone: "+5551996655445",
    email: "grazielle.pimentel@viviops.client",
    born: "1990-10-05",
    goal: "Definição muscular e emagrecimento",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    notes: "Preferência por Bi-Sets para otimizar os 30 minutos.",
  },
  {
    key: "juliana",
    name: "Juliana Souza",
    phone: "+5551995544332",
    email: "juliana.souza@viviops.client",
    born: "1995-12-15",
    goal: "Hipertrofia intensa e definição",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p4x60",
    paidDays: 28,
    notes: "Treina 4 vezes na semana. Carga progressiva.",
  },
  {
    key: "gabriela",
    name: "Gabriela Silveira",
    phone: "+5551994433221",
    email: "gabriela.silveira@viviops.client",
    born: "1993-03-22",
    goal: "Preparação para corrida e força",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p3x60",
    notes: "Corredora amadora de 10km.",
  },
  {
    key: "leticia",
    name: "Letícia Oliveira",
    phone: "+5551993322110",
    email: "leticia.oliveira@viviops.client",
    born: "1991-07-11",
    goal: "Consultoria online para academia de condomínio",
    modality: ONLINE,
    status: ACTIVE,
    plan: "cCompleta",
    paidDays: 10,
    notes: "Utiliza o PWA para executar os treinos e registrar cargas.",
  },
  {
    key: "mariana",
    name: "Mariana Duarte",
    phone: "+5551992211009",
    email: "mariana.duarte@viviops.client",
    born: "1987-09-08",
    goal: "Consultoria online - Treino em casa com halteres",
    modality: ONLINE,
    status: PAUSED,
    plan: "cCompleta",
    notes: "Plano pausado por 30 dias após procedimento cirúrgico.",
  },
  {
    key: "rodrigo",
    name: "Rodrigo Mendes",
    phone: "+5551991100998",
    email: "rodrigo.mendes@viviops.client",
    born: "1984-02-17",
    goal: "Ganho de massa magra e postura",
    modality: ONLINE,
    status: OVERDUE,
    plan: "cBasica",
    notes: "Mensalidade pendente de renovação.",
  },
  {
    key: "thiago",
    name: "Thiago Albuquerque",
    phone: "+5551990099887",
    email: "thiago.albuquerque@viviops.client",
    born: "1989-08-30",
    goal: "Performance e Hipertrofia",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p4x60",
    notes: "Treinos pesados de força e potência.",
  },
  {
    key: "vanessa",
    name: "Vanessa Camargo",
    phone: "+5551989988776",
    email: "vanessa.camargo@viviops.client",
    born: "1994-11-25",
    goal: "Híbrido: 2x presencial + 1x ficha no app",
    modality: HYBRID,
    status: ACTIVE,
    plan: "p2x30",
    notes: "Excelente aderência e consistência.",
  },
  {
    key: "lucas",
    name: "Lucas Fontana",
    phone: "+5551988877665",
    email: "lucas.fontana@viviops.client",
    born: "1996-06-19",
    goal: "Híbrido: Reavaliação presencial + fichas online",
    modality: HYBRID,
    status: ACTIVE,
    plan: "cCompleta",
    notes: "Foco em evolução de cargas no agachamento e supino.",
  },
  {
    key: "patricia",
    name: "Patrícia Helena",
    phone: "+5551987766554",
    email: "patricia.helena@viviops.client",
    born: "1976-03-14",
    goal: "Qualidade de vida e fortalecimento muscular",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p3x30",
    notes: "Aluna assídua há mais de 1 ano.",
  },
  {
    key: "fernanda",
    name: "Fernanda Souza Lead",
    phone: "+5551986655443",
    email: "fernanda.souza.lead@viviops.client",
    born: "1998-04-20",
    goal: "Emagrecimento e consultoria inicial",
    modality: ONLINE,
    status: LEAD,
    notes:
      "Lead captado via formulário do Instagram. Enviado link de anamnese.",
  },
  // Soft-deleted: try the resurrection of section 7 with POST /public/vivi-personal/leads and this e-mail.
  {
    key: "ex-aluna",
    name: "Beatriz Antiga Aluna",
    phone: "+5551985544332",
    email: "beatriz.antiga@viviops.client",
    goal: "Retorno aos treinos",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "p2x30",
    notes: "Cancelou o plano; registro mantido para histórico.",
    deleted: true,
  },
];

const CARLOS_CLIENTS: ClientSeed[] = [
  {
    key: "bruno",
    name: "Bruno Meirelles",
    phone: "+5551981112233",
    email: "bruno.meirelles@elitefit.client",
    goal: "Hipertrofia e Powerlifting",
    modality: PRESENCIAL,
    status: ACTIVE,
    plan: "cTrimestral",
    paidDays: 60,
  },
  {
    key: "camila",
    name: "Camila Peixoto",
    phone: "+5551982223344",
    email: "camila.peixoto@elitefit.client",
    goal: "Consultoria de Corrida e Resistência",
    modality: ONLINE,
    status: ACTIVE,
    plan: "cTrimestral",
  },
  {
    key: "marcos",
    name: "Marcos Vinicius Lead",
    phone: "+5551983334455",
    email: "marcos.lead@elitefit.client",
    goal: "Preparação para teste de aptidão física (TAF)",
    modality: PRESENCIAL,
    status: LEAD,
  },
];

const PLAN_PRICES: Record<PlanKey, number> = {
  p2x30: 350,
  p3x30: 450,
  p4x60: 650,
  p3x60: 550,
  cBasica: 180,
  cCompleta: 280,
  cTrimestral: 500,
};

const clientId = (key: string): string => seedId(`client:${key}`);

function subscriptionOf(seed: ClientSeed): SubscriptionStatus | null {
  if (seed.deleted) return SubscriptionStatus.CANCELED;
  return seed.paidDays === undefined ? null : SubscriptionStatus.ACTIVE;
}

async function seedClients(
  userId: string,
  seeds: ClientSeed[],
  plans: Record<PlanKey, string>,
): Promise<void> {
  await prisma.client.createMany({
    data: seeds.map((seed) => ({
      id: clientId(seed.key),
      userId,
      name: seed.name,
      phone: seed.phone,
      // crm normalises e-mails before every lookup; a mixed-case row would never match.
      email: seed.email.trim().toLowerCase(),
      dateOfBirth: seed.born ? new Date(seed.born) : null,
      goal: seed.goal,
      modality: seed.modality,
      status: seed.status,
      planId: seed.plan ? plans[seed.plan] : null,
      checkInFreq: seed.checkInFreq ?? null,
      notes: seed.notes ?? null,
      avatar: seed.avatar ?? null,
      subscriptionStatus: subscriptionOf(seed),
      currentPeriodEnd:
        seed.paidDays === undefined ? null : at(seed.paidDays, 23, 59),
      deletedAt: seed.deleted ? subDays(new Date(), 40) : null,
    })),
  });
  const methods = ["PIX", "CARD", "CASH"];
  await prisma.payment.createMany({
    data: seeds
      .filter((seed) => seed.paidDays !== undefined && seed.plan)
      .map((seed, index) => ({
        id: seedId(`payment:${seed.key}`),
        userId,
        clientId: clientId(seed.key),
        provider: PaymentProvider.MANUAL,
        status: PaymentStatus.PAID,
        amount: PLAN_PRICES[seed.plan as PlanKey],
        method: methods[index % methods.length],
        date: subDays(new Date(), 30 - (seed.paidDays as number)),
        periodEnd: at(seed.paidDays as number, 23, 59),
        notes: "Mensalidade registrada manualmente.",
      })),
  });
}

// ─── 5. Sheets, templates and student sessions ───────────────────────────────

/** Explicit ids: events (workoutSegmentId) and student sessions (executionData) point at them. */
const ANA_SHEET: WorkoutStructureInputDto = {
  workouts: [
    {
      id: "ana-treino-a",
      letter: "A",
      name: "Quadríceps & Peitoral",
      orderIndex: 0,
      blocks: [
        {
          id: "ana-a-b1",
          type: "REGULAR",
          orderIndex: 0,
          restTimeSeconds: 60,
          exercises: [
            {
              id: "ana-a-squat",
              exerciseId: "global-squat",
              exerciseName: "Agachamento Livre",
              gifUrl: "https://pub-r2.com/exercises/squat.gif",
              sets: 4,
              reps: "10-12",
              suggestedLoadKg: 30,
              executionNotes:
                "Descer até 90º com coluna neutra e joelhos alinhados com a ponta dos pés.",
            },
          ],
        },
        {
          id: "ana-a-b2",
          type: "BISET",
          orderIndex: 1,
          restTimeSeconds: 45,
          exercises: [
            {
              id: "ana-a-legpress",
              exerciseId: "global-leg-press",
              exerciseName: "Leg Press 45º",
              sets: 3,
              reps: "12-15",
              suggestedLoadKg: 80,
            },
            {
              id: "ana-a-bench",
              exerciseId: "global-bench-press",
              exerciseName: "Supino Reto com Barra",
              sets: 3,
              reps: "10-12",
              suggestedLoadKg: 20,
              orderIndex: 1,
            },
          ],
        },
      ],
    },
    {
      id: "ana-treino-b",
      letter: "B",
      name: "Glúteos & Costas",
      orderIndex: 1,
      blocks: [
        {
          id: "ana-b-b1",
          type: "REGULAR",
          orderIndex: 0,
          restTimeSeconds: 90,
          exercises: [
            {
              id: "ana-b-pelvica",
              exerciseId: seedId("exercise:elevacao-pelvica"),
              exerciseName: "Elevação Pélvica com Barra",
              sets: 4,
              reps: "8-10",
              suggestedLoadKg: 60,
            },
            {
              id: "ana-b-deadlift",
              exerciseId: "global-deadlift",
              exerciseName: "Levantamento Terra",
              sets: 3,
              reps: "8",
              suggestedLoadKg: 40,
              orderIndex: 1,
            },
          ],
        },
      ],
    },
  ],
};

const LETICIA_SHEET: WorkoutStructureInputDto = {
  workouts: [
    {
      id: "leticia-full-a",
      letter: "A",
      name: "Full Body A - Ênfase Inferiores",
      blocks: [
        {
          id: "leticia-a-b1",
          type: "REGULAR",
          restTimeSeconds: 60,
          exercises: [
            {
              id: "leticia-a-squat",
              exerciseId: "global-squat",
              exerciseName: "Agachamento Goblet",
              sets: 3,
              reps: "12",
              suggestedLoadKg: 12,
            },
            {
              id: "leticia-a-press",
              exerciseId: "global-shoulder-press",
              exerciseName: "Desenvolvimento com Halteres",
              sets: 3,
              reps: "10-12",
              suggestedLoadKg: 6,
              orderIndex: 1,
            },
          ],
        },
      ],
    },
  ],
};

const template = (
  description: string,
  tags: string[],
  letter: string,
  name: string,
  exerciseId: string,
  exerciseName: string,
): WorkoutStructureInputDto => ({
  description,
  tags,
  workouts: [
    {
      letter,
      name,
      blocks: [
        {
          type: "REGULAR",
          exercises: [{ exerciseId, exerciseName, sets: 5, reps: "5" }],
        },
      ],
    },
  ],
});

const structure = (input: WorkoutStructureInputDto): Prisma.InputJsonValue =>
  toJsonValue(buildWorkoutStructure(input));

async function seedSheets(viviId: string, carlosId: string): Promise<void> {
  const sheet = (
    key: string,
    userId: string,
    name: string,
    input: WorkoutStructureInputDto,
    extra: Partial<Prisma.WorkoutSheetCreateManyInput>,
  ) => ({
    id: seedId(`sheet:${key}`),
    userId,
    name,
    structure: structure(input),
    ...extra,
  });
  await prisma.workoutSheet.createMany({
    data: [
      // Client sheets: at most one active per client (partial unique index).
      sheet("ana", viviId, "Ficha Hipertrofia & Definição 2026", ANA_SHEET, {
        clientId: clientId("ana"),
        active: true,
        expiresAt: at(45, 12),
      }),
      sheet("ana-antiga", viviId, "Ficha Adaptação 2025", LETICIA_SHEET, {
        clientId: clientId("ana"),
        active: false,
        expiresAt: at(-30, 12),
      }),
      // Expires within 5 days: shows up in GET /workout-sheets/expiring.
      sheet(
        "leticia",
        viviId,
        "Consultoria Online - Ficha Condomínio",
        LETICIA_SHEET,
        { clientId: clientId("leticia"), active: true, expiresAt: at(3, 12) },
      ),
      // Templates: no client, always active.
      sheet(
        "tpl-hipertrofia",
        viviId,
        "Hipertrofia Feminina A/B/C",
        {
          ...ANA_SHEET,
          description: "Divisão A/B com ênfase em inferiores.",
          tags: ["hipertrofia", "feminino"],
          workouts: ANA_SHEET.workouts.map((w) => ({
            ...w,
            id: undefined,
            blocks: w.blocks.map((b) => ({
              ...b,
              id: undefined,
              exercises: b.exercises.map((e) => ({ ...e, id: undefined })),
            })),
          })),
        },
        { isTemplate: true },
      ),
      sheet(
        "tpl-emagrecimento",
        viviId,
        "Emagrecimento Full Body 30min",
        template(
          "Circuito de 30 minutos.",
          ["emagrecimento", "30min"],
          "A",
          "Full Body",
          "global-squat",
          "Agachamento Livre",
        ),
        { isTemplate: true },
      ),
      sheet(
        "tpl-powerlifting",
        carlosId,
        "Powerlifting Base Linear 5x5",
        template(
          "Progressão linear 5x5.",
          ["força"],
          "A",
          "Agachamento / Supino",
          "global-squat",
          "Barbell Back Squat",
        ),
        { isTemplate: true },
      ),
    ],
  });

  // Heatmap + lastLoadKg data: Ana executed workout A three times, Letícia once.
  const anaLoads = (squat: number) => [
    { workoutExerciseId: "ana-a-squat", loadKg: squat },
    { workoutExerciseId: "ana-a-legpress", loadKg: 85 },
    { workoutExerciseId: "ana-a-bench", loadKg: 20, completed: false },
  ];
  const session = (
    key: string,
    client: string,
    sheetKey: string,
    itemId: string,
    workoutName: string,
    daysAgo: number,
    loads: ReturnType<typeof anaLoads>,
  ) => ({
    id: seedId(`student-session:${key}`),
    clientId: clientId(client),
    workoutName,
    durationSeconds: 1800 + daysAgo * 30,
    completedAt: at(-daysAgo, 7, 30),
    executionData: toJsonValue(
      buildExecutionData({
        sheetId: seedId(`sheet:${sheetKey}`),
        itemId,
        loads,
      }),
    ),
  });
  await prisma.studentSession.createMany({
    data: [
      session(
        "ana-1",
        "ana",
        "ana",
        "ana-treino-a",
        "Treino A - Quadríceps & Peitoral",
        9,
        anaLoads(30),
      ),
      session(
        "ana-2",
        "ana",
        "ana",
        "ana-treino-a",
        "Treino A - Quadríceps & Peitoral",
        5,
        anaLoads(32.5),
      ),
      session(
        "ana-3",
        "ana",
        "ana",
        "ana-treino-a",
        "Treino A - Quadríceps & Peitoral",
        2,
        anaLoads(35),
      ),
      session(
        "leticia-1",
        "leticia",
        "leticia",
        "leticia-full-a",
        "Treino A - Full Body A - Ênfase Inferiores",
        1,
        [{ workoutExerciseId: "leticia-a-squat", loadKg: 14 }],
      ),
    ],
  });
}

// ─── 6. Calendar ─────────────────────────────────────────────────────────────

/** First `count` instants the rule really produces: an exception must replace one of them. */
function occurrences(rrule: string, dtstart: Date, count: number): Date[] {
  return expandRRuleForRange(
    rrule,
    dtstart,
    TIMEZONE,
    dtstart,
    addDays(dtstart, 60),
  ).slice(0, count);
}

async function seedCalendar(viviId: string, carlosId: string): Promise<void> {
  const base = {
    type: EventType.SESSION,
    timezone: TIMEZONE,
    sessionType: "In-Person",
    category: "Workout",
  };
  const oneOff = (
    key: string,
    userId: string,
    client: string,
    date: Date,
    extra: Partial<Prisma.EventCreateManyInput> = {},
  ) => ({
    ...base,
    id: seedId(`event:${key}`),
    userId,
    clientId: clientId(client),
    date,
    durationMinutes: 30,
    ...extra,
  });

  // Series master: `date` is DTSTART. Never listed as a row, only expanded.
  const seriesRule = "FREQ=WEEKLY;BYDAY=MO,WE";
  const seriesStart = at(-14, 9);
  const seriesId = seedId("event:series-juliana");
  const series = {
    ...base,
    id: seriesId,
    userId: viviId,
    clientId: clientId("juliana"),
    date: seriesStart,
    durationMinutes: 60,
    rrule: seriesRule,
    notes: "Treino fixo de segunda e quarta.",
  };
  const [first, second, third] = occurrences(seriesRule, seriesStart, 3);
  // Exceptions copy the master's client / sessionType / category / duration / timezone; notes null = use the master's.
  const exception = (
    key: string,
    original: Date,
    extra: Partial<Prisma.EventCreateManyInput>,
  ) => ({
    ...base,
    id: seedId(`event:${key}`),
    userId: viviId,
    clientId: clientId("juliana"),
    parentEventId: seriesId,
    originalStartTime: original,
    date: original,
    durationMinutes: 60,
    ...extra,
  });

  const block = (
    key: string,
    userId: string,
    title: string,
    date: Date,
    durationMinutes: number,
    rrule: string | null,
    notes: string,
  ) => ({
    id: seedId(`event:${key}`),
    type: EventType.BLOCK,
    userId,
    clientId: null,
    title,
    date,
    durationMinutes,
    rrule,
    timezone: TIMEZONE,
    notes,
  });

  await prisma.event.createMany({
    data: [
      oneOff("ana-past", viviId, "ana", at(-2, 8), {
        status: EventStatus.COMPLETED,
        workoutSheetId: seedId("sheet:ana"),
        workoutSegmentId: "ana-treino-a",
        notes: "Treino excelente, aumentou carga no agachamento.",
      }),
      oneOff("adriana-past", viviId, "adriana", at(-1, 8, 30), {
        status: EventStatus.COMPLETED,
        notes: "Sem queixas de dor lombar.",
      }),
      oneOff("cassia-next", viviId, "cassia", at(1, 10)),
      oneOff("ana-next", viviId, "ana", at(2, 8), {
        workoutSheetId: seedId("sheet:ana"),
        workoutSegmentId: "ana-treino-b",
      }),
      oneOff("leticia-checkin", viviId, "leticia", at(3, 17), {
        sessionType: "Online",
        category: "Check-in",
        durationMinutes: 20,
      }),
      oneOff("lucas-evaluation", viviId, "lucas", at(5, 15), {
        category: "Evaluation",
        durationMinutes: 60,
      }),
      oneOff("bruno-next", carlosId, "bruno", at(1, 18), {
        durationMinutes: 60,
      }),
      series,
    ],
  });
  await prisma.event.createMany({
    data: [
      exception("series-juliana-cancelled", first, {
        status: EventStatus.CANCELLED,
      }),
      exception("series-juliana-moved", second, {
        date: new Date(second.getTime() + 2 * 3_600_000),
        notes: "Remarcado para duas horas mais tarde.",
      }),
      exception("series-juliana-done", third, {
        status: EventStatus.COMPLETED,
      }),
      block(
        "lunch",
        viviId,
        "Horário de Almoço",
        at(0, 12),
        90,
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "Almoço e descanso diário",
      ),
      block(
        "study",
        viviId,
        "Atualização e Estudos",
        at(0, 18),
        90,
        "FREQ=WEEKLY;BYDAY=FR",
        "Estudos de biomecânica",
      ),
      block(
        "congress",
        viviId,
        "Congresso de Educação Física",
        at(10, 8),
        600,
        null,
        "Dia inteiro fora.",
      ),
    ],
  });
}

// ─── 7. Assessments ──────────────────────────────────────────────────────────

async function seedAssessments(viviId: string): Promise<void> {
  const base = (
    key: string,
    client: string,
    type: AssessmentType,
    data: object,
    date: Date,
  ) => ({
    id: seedId(`assessment:${key}`),
    type,
    userId: viviId,
    clientId: clientId(client),
    date,
    data: toJsonValue(data),
  });
  const { ANAMNESIS, PHYSICAL_EVALUATION } = AssessmentType;
  const parq = {
    q1: false,
    q2: false,
    q3: false,
    q4: false,
    q5: false,
    q6: false,
    q7: false,
  };

  await prisma.assessment.createMany({
    data: [
      // Submitted anamneses: magicToken null. The latest one per client is the current one.
      base(
        "anamnesis-ana",
        "ana",
        ANAMNESIS,
        buildAnamnesisData({
          medicalHistory:
            "Sem histórico de cirurgias. Pressão arterial normal.",
          injuriesAndPain: "Nenhuma dor limitante atual.",
          routineAndSchedule: "Estudante. Disponibilidade no início da manhã.",
          fitnessGoals:
            "Emagrecimento saudável e definição de membros inferiores.",
          experienceLevel: "Intermediário",
          weightKg: 58.5,
          parqAnswers: parq,
          measurements: {
            waist: 68,
            hip: 98,
            chest: 88,
            rightArm: 26,
            rightThigh: 54,
          },
          frontPhotoUrl: `${CDN}/evaluations/ana-front.png`,
        }),
        at(-60, 10),
      ),
      base(
        "anamnesis-adriana",
        "adriana",
        ANAMNESIS,
        buildAnamnesisData({
          medicalHistory:
            "Hérnia de disco lombar (L4-L5) diagnosticada em 2022.",
          injuriesAndPain: "Dor lombar ocasional ao ficar muito tempo sentada.",
          fitnessGoals: "Emagrecimento e fortalecimento do core.",
          experienceLevel: "Iniciante",
          parqAnswers: { ...parq, q5: true },
        }),
        at(-45, 14),
      ),
      // Pending (link not used yet) and expired requests: data stays { version: 1 }.
      {
        ...base(
          "anamnesis-fernanda-pending",
          "fernanda",
          ANAMNESIS,
          EMPTY_ANAMNESIS_DATA,
          at(-1, 9),
        ),
        magicToken: buildIdempotencyKey([
          "seed",
          "anamnesis",
          "fernanda",
        ]).padEnd(64, "0"),
        tokenExpiresAt: at(6, 9),
      },
      {
        ...base(
          "anamnesis-rodrigo-expired",
          "rodrigo",
          ANAMNESIS,
          EMPTY_ANAMNESIS_DATA,
          at(-20, 9),
        ),
        magicToken: buildIdempotencyKey([
          "seed",
          "anamnesis",
          "rodrigo",
        ]).padEnd(64, "0"),
        tokenExpiresAt: at(-13, 9),
      },
      // Physical evaluations: `date` is the evaluation date; a numeric weight is mandatory.
      base(
        "evaluation-ana-1",
        "ana",
        PHYSICAL_EVALUATION,
        buildPhysicalEvaluationData({
          weight: 58.5,
          notes: "Anamnese inicial preenchida pelo aluno",
          perimeters: {
            waist: 68,
            hip: 98,
            chest: 88,
            rightArm: 26,
            rightThigh: 54,
          },
        }),
        at(-60, 10),
      ),
      base(
        "evaluation-ana-2",
        "ana",
        PHYSICAL_EVALUATION,
        buildPhysicalEvaluationData({
          weight: 57.2,
          height: 1.65,
          bodyFatPercentage: 23.4,
          leanMass: 43.8,
          fatMass: 13.4,
          bodyDensity: 1.0462,
          protocol: "POLLOCK_3",
          equation: "SIRI",
          notes: "Boa evolução em 60 dias.",
          skinfolds: { triceps: 16, suprailiac: 14, thigh: 22 },
          perimeters: { waist: 66, hip: 97 },
        }),
        at(-3, 10),
      ),
      base(
        "evaluation-juliana",
        "juliana",
        PHYSICAL_EVALUATION,
        buildPhysicalEvaluationData({ weight: 63, height: 1.7 }),
        at(-15, 16),
      ),
    ],
  });
}

// ─── 8. Notification audit trail ─────────────────────────────────────────────

async function seedNotificationLogs(viviId: string): Promise<void> {
  // Finished outcomes only (SENT / FAILED / CANCELLED), WhatsApp only, one distinct jobId per row.
  const log = (
    n: number,
    client: string,
    phone: string,
    templateType: string,
    status: "SENT" | "FAILED" | "CANCELLED",
    error: string | null,
    daysAgo: number,
  ) => ({
    id: seedId(`notification:${n}`),
    userId: viviId,
    clientId: clientId(client),
    recipientPhone: phone,
    templateType,
    status,
    channel: "WHATSAPP",
    error,
    jobId: buildIdempotencyKey(["seed", String(n)]),
    createdAt: at(-daysAgo, 11),
  });
  await prisma.notificationLog.createMany({
    data: [
      log(1, "ana", "+5551991849376", "WELCOME_ANAMNESIS", "SENT", null, 60),
      log(
        2,
        "adriana",
        "+5551992641343",
        "WELCOME_ANAMNESIS",
        "SENT",
        null,
        45,
      ),
      log(3, "leticia", "+5551993322110", "WORKOUT_LINK", "SENT", null, 7),
      log(
        4,
        "rodrigo",
        "+5551991100998",
        "WELCOME_ANAMNESIS",
        "FAILED",
        "WHATSAPP_NOT_CONNECTED: WhatsApp do treinador não está conectado (status DISCONNECTED).",
        20,
      ),
      log(
        5,
        "mariana",
        "+5551992211009",
        "EXPIRATION_ALERT",
        "FAILED",
        "WHATSAPP_TRANSIENT (HTTP 503): upstream unavailable",
        4,
      ),
      log(
        6,
        "fernanda",
        "+5551986655443",
        "WELCOME_ANAMNESIS",
        "CANCELLED",
        "Cancelado manualmente pelo treinador.",
        1,
      ),
    ],
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

/**
 * @param env Environment the guards read (injected in tests)
 * @param connect Opens the database; called only after every guard has passed
 * @throws {Error} In production without SEED_ALLOW_PRODUCTION=true or without
 *   SEED_ADMIN_PASSWORD, and without DATABASE_URL — all before connecting
 */
export async function main(
  env: ScriptEnv = process.env,
  connect: (databaseUrl: string) => SeedConnection = connectTo,
): Promise<void> {
  assertSeedAllowed(env);
  const password = resolveSeedPassword(env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed.");
  }
  const connection = connect(env.DATABASE_URL);
  prisma = connection.prisma;
  try {
    await seed(password);
  } finally {
    await connection.close();
  }
}

async function seed(password: string): Promise<void> {
  console.log("[seed] accounts");
  const users = await seedAccounts(password);
  const viviId = users.get("vivi-personal") as string;
  const carlosId = users.get("elite-fit-studio") as string;

  console.log("[seed] clearing data owned by the demo accounts");
  await clearOwnedData([...users.values()]);

  console.log("[seed] exercises, plans, clients, payments");
  await seedExercises(viviId, carlosId);
  const plans = await seedPlans(viviId, carlosId);
  await seedClients(viviId, VIVI_CLIENTS, plans);
  await seedClients(carlosId, CARLOS_CLIENTS, plans);

  console.log("[seed] sheets, calendar, assessments, notification logs");
  await seedSheets(viviId, carlosId);
  await seedCalendar(viviId, carlosId);
  await seedAssessments(viviId);
  await seedNotificationLogs(viviId);

  const counts = {
    users: await prisma.user.count(),
    clients: await prisma.client.count(),
    plans: await prisma.plan.count(),
    payments: await prisma.payment.count(),
    exercises: await prisma.exercise.count(),
    workoutSheets: await prisma.workoutSheet.count(),
    studentSessions: await prisma.studentSession.count(),
    events: await prisma.event.count(),
    assessments: await prisma.assessment.count(),
    notificationLogs: await prisma.notificationLog.count(),
  };
  console.log(`[seed] done ${JSON.stringify(counts)}`);
  // Never print a password that came from the environment.
  const passwordHint =
    password === DEMO_PASSWORD
      ? `password "${DEMO_PASSWORD}"`
      : "password from SEED_ADMIN_PASSWORD";
  console.log(
    `[seed] login: admin@gym.com (admin) or carlos@elitefit.com (trainer), ${passwordHint} for accounts created by this run (existing accounts keep theirs)`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  });
}
