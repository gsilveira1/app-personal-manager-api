import { IsArray, IsUUID } from 'class-validator';

export class BatchPixDto {
    @IsArray()
    @IsUUID('4', { each: true })
    ids!: string[];
}
