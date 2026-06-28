// src/lib/aliexpress-client.ts
import crypto from 'crypto';
import { prisma } from './db';

export interface AliParams {
  [key: string]: string;
}

function buildSignature(params: AliParams, secret: string): string {
  // Sort parameters alphabetically, exclude 'sign' itself
  const sorted = Object.keys(params).filter(k => k !== 'sign').sort();
  // Concatenate key1value1key2value2... (no prefix)
  const toSign = sorted.map(k => `${k}${params[k]}`).join('');

  return crypto
    .createHmac('sha256', secret)
    .update(toSign)
    .digest('hex')
    .toUpperCase();
}

export async function callAliExpress(method: string, params: AliParams) {
  // Load settings from database
  const dbSettings = await prisma.setting.findMany();
  const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]));

  const appKey = settingsMap.get('aliexpress_app_key') || process.env.ALIEXPRESS_APP_KEY;
  const appSecret = settingsMap.get('aliexpress_app_secret') || process.env.ALIEXPRESS_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error('AliExpress App Key or App Secret is not configured in settings or environment.');
  }

  const baseParams: AliParams = {
    method,
    app_key: appKey,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    sign_method: 'hmac-sha256',
    format: 'json',
    v: '2.0',
    ...params
  };

  // Generate signature
  baseParams.sign = buildSignature(baseParams, appSecret);

  const url = new URL('https://api-sg.aliexpress.com/sync');
  Object.entries(baseParams).forEach(([k, v]) => {
    url.searchParams.set(k, v);
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    // Prevent caching for API calls
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`AliExpress API returned status ${response.status}: ${response.statusText}`);
  }
  return response.json();
}
