import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './users-create.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {}