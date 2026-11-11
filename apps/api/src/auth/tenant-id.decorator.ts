import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Resolves the tenant set on the request by ApiKeyGuard.
export const TenantId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest().tenantId,
);
