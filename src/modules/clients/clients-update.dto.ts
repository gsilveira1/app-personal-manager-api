import { PartialType } from '@nestjs/mapped-types';
import { CreateClientDto } from './clients-create.dto';

export class UpdateClientDto extends PartialType(CreateClientDto) {}