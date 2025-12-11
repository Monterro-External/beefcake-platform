import type { AccessProvider, AccessProviderName } from '../types';
import { type ProviderOptions, createAccessProviderA } from './provider-a';
import { createAccessProviderB } from './provider-b';

/**
 * Both vendors, keyed by the value stored in `sites.access_provider`. Anything
 * that talks to hardware resolves through here, so adding a third vendor is one
 * file plus one line.
 */
export function accessProviders(options: ProviderOptions = {}): Record<AccessProviderName, AccessProvider> {
  return {
    'access-provider-a': createAccessProviderA(options),
    'access-provider-b': createAccessProviderB(options),
  };
}

export function accessProviderFor(
  name: AccessProviderName,
  options: ProviderOptions = {},
): AccessProvider {
  return accessProviders(options)[name];
}
