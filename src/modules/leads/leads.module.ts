import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
    imports: [PrismaModule, ConfigModule],
    controllers: [LeadsController],
    providers: [LeadsService],
})
export class LeadsModule { }
