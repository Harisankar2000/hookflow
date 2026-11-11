import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

export class PublishEventDto {
  // Dotted names such as "order.created".
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  type: string;

  @IsObject()
  payload: Record<string, unknown>;
}
