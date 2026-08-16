import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

import { UsersService } from "./users.service";
import { CreateUserDto } from "./users-create.dto";
import { UpdateUserDto } from "./users-update.dto";
import { UserAvatarUploadDto } from "./user-avatar-upload.dto";
import { RequestWithUser } from "../../types/global";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // IMPORTANT: Static endpoints must be defined before :id parameter routes
  @Patch("profile")
  @UseGuards(AuthGuard("jwt"))
  updateProfile(
    @Request() req: RequestWithUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(req.user.userId, updateUserDto);
  }

  @Post("avatar-upload-url")
  @UseGuards(AuthGuard("jwt"))
  generateAvatarUploadUrl(
    @Request() req: RequestWithUser,
    @Body() dto: UserAvatarUploadDto,
  ) {
    return this.usersService.generateAvatarUploadUrl(
      req.user.userId,
      dto.contentType,
    );
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }
}
