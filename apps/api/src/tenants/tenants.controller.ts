import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { config } from '../config';
import { generateApiKey, hashApiKey } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly prisma: PrismaService) {}

  // The API key is returned once here and only its hash is stored.
  @Post()
  async create(@Headers('x-admin-token') adminToken: string, @Body() dto: CreateTenantDto) {
    if (!config.adminToken() || adminToken !== config.adminToken()) {
      throw new ForbiddenException('Invalid admin token');
    }
    const apiKey = generateApiKey();
    const tenant = await this.prisma.tenant.create({
      data: { name: dto.name, apiKeyHash: hashApiKey(apiKey), apiKeyPrefix: apiKey.slice(0, 7) },
    });
    return { id: tenant.id, name: tenant.name, apiKey };
  }
}
