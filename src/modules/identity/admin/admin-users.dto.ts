import { PartialType } from "@nestjs/mapped-types";
import { AccountStatus } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { AccountLimitsDto } from "../../../common/types";

export const ADMIN_USERS_DEFAULT_LIMIT = 20;
export const ADMIN_USERS_MAX_LIMIT = 100;

export class AdminUserQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_USERS_MAX_LIMIT)
  limit?: number = ADMIN_USERS_DEFAULT_LIMIT;

  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}

export class AccountLimitsPatchDto extends PartialType(AccountLimitsDto) {}

/** Body of PATCH /admin/users/:id. */
export class UpdateUserAdminDto {
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => AccountLimitsPatchDto)
  limits?: AccountLimitsPatchDto;
}
