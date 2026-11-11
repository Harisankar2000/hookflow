import { createHash, randomBytes } from 'node:crypto';

export const hashApiKey = (apiKey: string) => createHash('sha256').update(apiKey).digest('hex');

export const generateApiKey = () => `hf_${randomBytes(24).toString('base64url')}`;

export const generateEndpointSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;
