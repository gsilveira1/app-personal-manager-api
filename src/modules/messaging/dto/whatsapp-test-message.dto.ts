import { IsNotEmpty, IsString, Matches } from "class-validator";

/** Body of `POST /whatsapp/test-message`. */
export class WhatsAppTestMessageDto {
  @IsNotEmpty({ message: "O número de telefone é obrigatório" })
  @IsString()
  @Matches(/^[0-9+() -]{10,20}$/, {
    message: "Formato de telefone inválido para disparo de teste",
  })
  phone!: string;

  @IsNotEmpty({ message: "A mensagem de teste não pode ser vazia" })
  @IsString()
  message!: string;
}
