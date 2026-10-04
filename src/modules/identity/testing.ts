import { AccountStatus, Prisma, User, WhatsappStatus } from "@prisma/client";

/** A complete User row for unit tests. */
export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-uuid-1",
    name: "João Silva",
    email: "joao@example.com",
    password: "$2b$10$hashedpassword",
    role: "trainer",
    status: AccountStatus.ACTIVE,
    avatar: null,
    phone: null,
    bio: null,
    slug: "joao-silva",
    primaryColor: "#10B981",
    logoUrl: null,
    whatsappInstanceName: null,
    whatsappStatus: WhatsappStatus.PENDING,
    setupCompleted: false,
    settings: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

/** A Prisma request error as the client throws it. */
export function prismaError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, {
    code,
    clientVersion: "test",
    meta,
  });
}
