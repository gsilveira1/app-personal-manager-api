import {
    IsString,
    IsDateString,
    IsInt,
    IsOptional,
    IsBoolean,
    IsUUID,
    Min,
    Matches,
} from 'class-validator';

/**
 * DTO for creating an RFC 5545-compliant recurring event.
 * The RRULE string is the single source of truth for the recurrence pattern.
 * Instances are materialized in-memory — nothing is pre-created in the DB.
 */
export class CreateRecurringEventDto {
    /**
     * Full RRULE property value (without the "RRULE:" prefix), e.g.:
     * "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12"
     * "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20250101T000000Z"
     */
    @IsString()
    @Matches(/^FREQ=/, { message: 'rrule must start with FREQ=' })
    rrule!: string;

    /** TZID for the rule expansion (e.g. "America/Sao_Paulo") */
    @IsString()
    timezone!: string;

    /** ISO datetime of the first occurrence (= DTSTART) */
    @IsDateString()
    dtstart!: string;

    @IsInt()
    @Min(1)
    durationMinutes!: number;

    @IsString()
    type!: string;

    @IsString()
    category!: string;

    @IsUUID()
    clientId!: string;

    @IsOptional()
    @IsUUID()
    linkedWorkoutId?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

/**
 * DTO for creating/updating a single exception to a recurring event.
 * Maps to the SessionException model.
 */
export class UpsertSessionExceptionDto {
    @IsUUID()
    recurringEventId!: string;

    /** The original computed start time of the occurrence being overridden */
    @IsDateString()
    originalStartTime!: string;

    /** If true, the occurrence is cancelled (soft-deleted from the series) */
    @IsOptional()
    @IsBoolean()
    cancelled?: boolean;

    /** New start time (rescheduling this specific occurrence) */
    @IsOptional()
    @IsDateString()
    newStartTime?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    durationMinutes?: number;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsBoolean()
    completed?: boolean;
}
