import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ConvertLeadDto {
    @IsOptional()
    @IsString()
    @IsUUID()
    planId?: string;
}
