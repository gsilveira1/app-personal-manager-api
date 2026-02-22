import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateLeadDto } from './create-lead.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
    constructor(private readonly leadsService: LeadsService) { }

    /**
     * Public endpoint — no JWT required.
     * Called by the website-vivi contact form when a visitor submits their details.
     * Creates a new Client record with status = Lead in the trainer's account.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    create(@Body() createLeadDto: CreateLeadDto) {
        return this.leadsService.create(createLeadDto);
    }
}
