import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  JwtAuthGuard,
  ROLE_ADMIN,
  Roles,
  RolesGuard,
} from "../../../common/auth";
import { AdminUserQueryDto, UpdateUserAdminDto } from "./admin-users.dto";
import { AdminUsersService } from "./admin-users.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLE_ADMIN)
@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  findAll(@Query() query: AdminUserQueryDto) {
    return this.adminUsersService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.adminUsersService.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateUserAdminDto) {
    return this.adminUsersService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.adminUsersService.remove(id);
  }
}
