import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { ROLE_TRAINER } from "../../../common/auth";
import { GcsService } from "../../gcs/gcs.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_VIOLATION,
  uniqueViolationFields,
  userNotFound,
  violatesUnique,
} from "../errors";
import { SLUG_COLLISION_RETRIES, slugCandidate } from "../slug";
import { toUserView, UserView } from "../user-view";
import { UpdateBrandingDto } from "./dto/branding.dto";
import { SignupDto } from "./dto/signup.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

const BCRYPT_ROUNDS = 10;
const EMAIL_IN_USE = "Este e-mail já está em uso.";
const SLUG_IN_USE = "Este endereço público (slug) já está em uso.";

const SESSION_ACCOUNT_SELECT = {
  id: true,
  name: true,
  role: true,
  status: true,
  password: true,
} as const;

/** What JwtStrategy needs to decide whether an access token is still good. */
export type SessionAccount = Pick<User, keyof typeof SESSION_ACCOUNT_SELECT>;

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Account lifecycle and the trainer's own profile. Owner of the User model. */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcs: GcsService,
  ) {}

  /**
   * Creates a trainer account. The role is never taken from the request.
   *
   * @returns The stored row (with the password hash; map it with toUserView before returning it)
   * @throws {ConflictException} When the e-mail is already registered
   * @throws {InternalServerErrorException} When no free slug was found after the retries
   *
   * @example
   * const user = await usersService.create({ name: "Ana", email: "ana@x.com", password: "segredo" });
   */
  async create(dto: SignupDto): Promise<User> {
    const email = normalizeEmail(dto.email);
    if (await this.emailExists(email)) {
      throw new ConflictException(EMAIL_IN_USE);
    }
    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    for (let attempt = 0; attempt <= SLUG_COLLISION_RETRIES; attempt++) {
      const slug = slugCandidate(dto.name, attempt);
      const data = {
        name: dto.name,
        email,
        password,
        role: ROLE_TRAINER,
        slug,
      };
      try {
        return await this.prisma.user.create({ data });
      } catch (error) {
        if (!isPrismaError(error, UNIQUE_VIOLATION)) throw error;
        if (await this.isEmailViolation(error, email)) {
          throw new ConflictException(EMAIL_IN_USE);
        }
        this.logger.warn(`Slug "${slug}" is taken (attempt ${attempt + 1})`);
      }
    }
    this.logger.error(
      `No free slug for "${dto.name}" after ${SLUG_COLLISION_RETRIES} retries`,
    );
    throw new InternalServerErrorException(
      "Não foi possível gerar um endereço público para a conta. Tente novamente.",
    );
  }

  /** @throws {NotFoundException} When the user does not exist */
  async findOne(id: string): Promise<UserView> {
    return toUserView(await this.requireUser(id));
  }

  /**
   * Lookup for the login flow: the only read that returns the password hash.
   * @returns null when the e-mail is not registered
   */
  findByEmailForAuth(email: string): Promise<User | null> {
    if (!email) return Promise.resolve(null);
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  /**
   * Lookup behind every authenticated request: one primary-key read.
   * @returns null when the account no longer exists
   */
  findSessionAccount(id: string): Promise<SessionAccount | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: SESSION_ACCOUNT_SELECT,
    });
  }

  /**
   * @throws {NotFoundException} When the user does not exist
   * @throws {ConflictException} When the e-mail or the slug belongs to another account
   */
  async updateProfile(id: string, dto: UpdateProfileDto): Promise<UserView> {
    await this.requireUser(id);
    const data: Prisma.UserUpdateInput = { ...dto };
    if (dto.email) data.email = normalizeEmail(dto.email);
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }
    return this.applyUpdate(id, data);
  }

  /** @throws {NotFoundException} When the user does not exist */
  updateBranding(id: string, dto: UpdateBrandingDto): Promise<UserView> {
    return this.applyUpdate(id, {
      ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      ...(dto.primaryColor !== undefined && { primaryColor: dto.primaryColor }),
    });
  }

  /** Marks the onboarding wizard as finished. Idempotent. */
  async completeSetup(id: string): Promise<{ success: true; user: UserView }> {
    const user = await this.applyUpdate(id, { setupCompleted: true });
    return { success: true, user };
  }

  /** @throws {NotFoundException} When the user does not exist */
  async generateAvatarUploadUrl(userId: string, contentType: string) {
    await this.requireUser(userId);
    const ext = contentType.split("/")[1] || "png";
    return this.gcs.generateSignedUploadUrl(
      `avatars/users/${userId}.${ext}`,
      contentType,
    );
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw userNotFound(id);
    return user;
  }

  private async emailExists(email: string): Promise<boolean> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return existing !== null;
  }

  /** Falls back to a lookup when Prisma does not name the violated column. */
  private async isEmailViolation(
    error: Prisma.PrismaClientKnownRequestError,
    email: string,
  ): Promise<boolean> {
    if (uniqueViolationFields(error).length > 0) {
      return violatesUnique(error, "email");
    }
    return this.emailExists(email);
  }

  private async applyUpdate(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<UserView> {
    try {
      return toUserView(await this.prisma.user.update({ where: { id }, data }));
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) throw userNotFound(id);
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        throw new ConflictException(uniqueConflictMessage(error));
      }
      throw error;
    }
  }
}

function uniqueConflictMessage(
  error: Prisma.PrismaClientKnownRequestError,
): string {
  if (violatesUnique(error, "slug")) return SLUG_IN_USE;
  if (violatesUnique(error, "email")) return EMAIL_IN_USE;
  return "E-mail ou endereço público (slug) já está em uso.";
}
