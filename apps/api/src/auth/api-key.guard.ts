import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from '../common/crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    const apiKey = header?.startsWith('Bearer ') ? header.slice(7).trim() : request.headers['x-api-key'];
    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Missing API key');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    if (!tenant) {
      throw new UnauthorizedException('Invalid API key');
    }
    request.tenantId = tenant.id;
    return true;
  }
}
