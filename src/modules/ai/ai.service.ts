import {
  BadGatewayException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";
import { USER_DIRECTORY, UserDirectory } from "../../common/ports";
import {
  AiClientDto,
  AiEvaluationDto,
  AiMedicalHistoryDto,
} from "./dto/ai-context.dto";
import { GenerateWorkoutPlanDto } from "./dto/generate-workout-plan.dto";
import { GenerateWorkoutInsightsDto } from "./dto/generate-workout-insights.dto";

const DEFAULT_PERSONA_PROMPT = `Você é um personal trainer experiente e consultor de fitness.
Priorize a segurança do aluno acima de tudo. Respeite limitações físicas e condições médicas.
Sugira progressões graduais e sempre inclua aquecimento e volta à calma.
Comunique-se de forma clara e profissional em português brasileiro.`;

const MODEL = "gemini-3-pro-preview";
/** The only text a caller sees when the provider fails; details go to the log. */
export const AI_PROVIDER_FAILURE_MESSAGE = "AI provider request failed";

const WORKOUT_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    exercises: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          sets: { type: Type.NUMBER },
          reps: { type: Type.STRING },
          notes: { type: Type.STRING },
        },
        propertyOrdering: ["name", "sets", "reps", "notes"],
      },
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
};

const WORKOUT_INSIGHTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    insights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          suggestion: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              sets: { type: Type.NUMBER },
              reps: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ["name", "sets", "reps"],
          },
          reason: { type: Type.STRING },
        },
        required: ["suggestion", "reason"],
      },
    },
  },
  required: ["insights"],
};

function ageOf(client?: AiClientDto): number | string {
  return client?.dateOfBirth
    ? new Date().getFullYear() - new Date(client.dateOfBirth).getFullYear()
    : "N/A";
}

function describeMedicalHistory(history?: AiMedicalHistoryDto): string {
  if (!history) return "Nenhum histórico médico registrado.";
  const parts = [
    history.objective?.length && `Objetivos: ${history.objective.join(", ")}`,
    history.injuries && `Lesões: ${history.injuries}`,
    history.surgeries && `Cirurgias: ${history.surgeries}`,
    history.medications && `Medicamentos: ${history.medications}`,
    history.hasHeartDisease && "Doença cardíaca: Sim",
    history.smoker && "Fumante: Sim",
    history.drinker && "Consome álcool: Sim",
    history.observations && `Observações: ${history.observations}`,
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0
    ? parts.join("\n      ")
    : "Nenhum histórico médico registrado.";
}

function clientBlock(client: AiClientDto | undefined, goal: string): string {
  if (!client) return "";
  return `
        CLIENT PROFILE:
        - Name: ${client.name}
        - Age: ${ageOf(client)}
        - Goal: ${client.goal || goal}
        - Notes: ${client.notes || "None"}
        - Medical History:
        ${describeMedicalHistory(client.medicalHistory)}
      `;
}

function evaluationBlock(evaluation?: AiEvaluationDto): string {
  if (!evaluation) return "";
  return `
        LATEST EVALUATION:
        - Weight: ${evaluation.weight} kg
        - Body Fat: ${evaluation.bodyFatPercentage}%
        - Notes: ${evaluation.notes || "None"}
      `;
}

function workoutPlanPrompt(
  persona: string,
  params: GenerateWorkoutPlanDto,
): string {
  return `
      TRAINER INSTRUCTIONS:
      ${persona}

      ${clientBlock(params.client, params.goal)}
      ${evaluationBlock(params.latestEvaluation)}

      WORKOUT PARAMETERS:
      - Client Name: ${params.clientName}
      - Goal: ${params.goal}
      - Experience Level: ${params.experienceLevel}
      - Physical Limitations: ${params.limitations || "None"}
      - Frequency: ${params.daysPerWeek} days per week.

      Please provide a structured response with a title, description, and a list of exercises for a single representative session.
    `;
}

function workoutInsightsPrompt(
  persona: string,
  params: GenerateWorkoutInsightsDto,
): string {
  const pastPlans =
    params.archivedPlans.length > 0
      ? params.archivedPlans
          .map(
            (plan) =>
              `- ${plan.title ?? "Untitled"}: ${plan.description ?? ""}`,
          )
          .join("\n")
      : "No past plans available.";
  return `
        TRAINER INSTRUCTIONS:
        ${persona}

        Your task is to provide actionable suggestions for a new workout plan based on the client's detailed profile.

        CLIENT PROFILE:
        - Name: ${params.client.name}
        - Age: ${ageOf(params.client)}
        - Primary Goal: ${params.client.goal}
        - Notes from Trainer: ${params.client.notes || "None"}
        - Medical History:
        ${describeMedicalHistory(params.client.medicalHistory)}

        LATEST EVALUATION DATA (if available):
        - Weight: ${params.latestEvaluation?.weight} kg
        - Body Fat: ${params.latestEvaluation?.bodyFatPercentage}%
        - Evaluation Notes: ${params.latestEvaluation?.notes || "None"}

        PAST WORKOUTS (Archived Plans):
        ${pastPlans}

        TASK:
        Based on all of the information above, provide 3-5 specific and actionable suggestions for the new workout plan. For each suggestion, provide the rationale ("reason") and a concrete exercise suggestion with name, sets, reps, and optional notes.
        Focus on safety, effectiveness, and alignment with the client's goal. The 'reps' can be a string like '8-10' or '60s'. 'notes' should be concise.
        Return the data in the specified JSON format.

        Example suggestion:
        {
          "suggestion": {
            "name": "Bulgarian Split Squats",
            "sets": 3,
            "reps": "10-12 per leg",
            "notes": "Focus on stability."
          },
          "reason": "This addresses the client's goal of marathon prep and helps strengthen the muscles around their sensitive right knee."
        }
      `;
}

/** `status=429 message=...` of whatever the SDK threw. */
function describeProviderError(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status ?? "unknown";
  const message = error instanceof Error ? error.message : String(error);
  return `status=${String(status)} message=${message}`;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  /**
   * @throws {NotFoundException} When the trainer does not exist
   * @throws {BadGatewayException} When the provider fails or answers something unusable
   */
  async generateWorkoutPlan(userId: string, params: GenerateWorkoutPlanDto) {
    const persona = await this.personaFor(userId, params.customInstructions);
    return this.generateJson(
      "workout plan",
      workoutPlanPrompt(persona, params),
      WORKOUT_PLAN_SCHEMA,
    );
  }

  /**
   * @throws {NotFoundException} When the trainer does not exist
   * @throws {BadGatewayException} When the provider fails or answers something unusable
   */
  async generateWorkoutInsights(
    userId: string,
    params: GenerateWorkoutInsightsDto,
  ) {
    const persona = await this.personaFor(userId, params.customInstructions);
    return this.generateJson(
      "workout insights",
      workoutInsightsPrompt(persona, params),
      WORKOUT_INSIGHTS_SCHEMA,
    );
  }

  /** Request instructions, else the trainer's stored `settings.aiInstructions`, else the default persona. */
  private async personaFor(
    userId: string,
    customInstructions?: string,
  ): Promise<string> {
    if (customInstructions?.trim()) return customInstructions;
    const { aiInstructions } = await this.users.getSettings(userId);
    return aiInstructions?.trim() ? aiInstructions : DEFAULT_PERSONA_PROMPT;
  }

  private getAiClient(): GoogleGenAI {
    const apiKey =
      this.configService.get<string>("GEMINI_API_KEY") ||
      this.configService.get<string>("VITE_API_GMKEY") ||
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      this.logger.error("GEMINI_API_KEY is not configured on the backend.");
      throw new InternalServerErrorException(
        "Gemini API key is not configured on backend server.",
      );
    }

    return new GoogleGenAI({ apiKey });
  }

  /**
   * One provider call. Whatever goes wrong upstream is logged with its status and
   * message and answered with a 502 that carries no provider text.
   */
  private async generateJson(
    label: string,
    prompt: string,
    responseSchema: object,
  ): Promise<unknown> {
    const ai = this.getAiClient();
    let text: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema },
      });
      text = response.text?.trim();
    } catch (error) {
      this.logger.error(
        `Gemini request for ${label} failed: ${describeProviderError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException(AI_PROVIDER_FAILURE_MESSAGE);
    }
    if (!text) {
      this.logger.error(`Gemini answered ${label} with an empty body`);
      throw new BadGatewayException(AI_PROVIDER_FAILURE_MESSAGE);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      this.logger.error(
        `Gemini answered ${label} with text that is not JSON (${text.length} characters): ${(error as Error).message}`,
      );
      throw new BadGatewayException(AI_PROVIDER_FAILURE_MESSAGE);
    }
  }
}
