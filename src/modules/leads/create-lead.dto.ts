import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLeadDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsEmail()
    email!: string;

    @IsString()
    @IsNotEmpty()
    phone!: string;

    @IsIn(['presencial', 'online', 'ambos'])
    interest!: 'presencial' | 'online' | 'ambos';

    @IsString()
    @IsOptional()
    message?: string;
}
