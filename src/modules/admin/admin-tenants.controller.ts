import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AdminTenantsService } from "./admin-tenants.service";
import {
  AdminTenantQueryDto,
  CreateTenantAdminDto,
  UpdateTenantAdminDto,
} from "./dto/admin.dto";

@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("admin", "ADMIN")
@Controller("admin/tenants")
export class AdminTenantsController {
  constructor(private readonly adminTenantsService: AdminTenantsService) {}

  @Get()
  findAll(@Query() query: AdminTenantQueryDto) {
    return this.adminTenantsService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTenantAdminDto) {
    return this.adminTenantsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateTenantAdminDto) {
    return this.adminTenantsService.update(id, dto);
  }
}
