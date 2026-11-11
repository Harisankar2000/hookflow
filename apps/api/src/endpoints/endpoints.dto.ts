import { PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateEndpointDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  // Leave empty to receive every event type.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  eventTypes?: string[];
}

export class UpdateEndpointDto extends PartialType(CreateEndpointDto) {}
