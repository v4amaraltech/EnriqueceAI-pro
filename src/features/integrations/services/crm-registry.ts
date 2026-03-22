import type { CRMAdapter, CrmProvider } from '../types/crm';
import { HubSpotAdapter } from './hubspot.adapter';
import { KommoAdapter } from './kommo.adapter';
import { PipedriveAdapter } from './pipedrive.adapter';
import { RDStationAdapter } from './rdstation.adapter';

const adapters: Partial<Record<CrmProvider, CRMAdapter>> = {};

function getOrCreateAdapter(provider: CrmProvider): CRMAdapter {
  if (!adapters[provider]) {
    switch (provider) {
      case 'hubspot':
        adapters[provider] = new HubSpotAdapter();
        break;
      case 'pipedrive':
        adapters[provider] = new PipedriveAdapter();
        break;
      case 'rdstation':
        adapters[provider] = new RDStationAdapter();
        break;
      case 'kommo':
        adapters[provider] = new KommoAdapter();
        break;
      default:
        throw new Error(`Unknown CRM provider: ${provider}`);
    }
  }
  return adapters[provider]!;
}

export const CRMRegistry = {
  getAdapter: getOrCreateAdapter,

  getSupportedProviders(): CrmProvider[] {
    return ['hubspot', 'pipedrive', 'rdstation', 'kommo'];
  },

  isSupported(provider: string): provider is CrmProvider {
    return ['hubspot', 'pipedrive', 'rdstation', 'kommo'].includes(provider);
  },
};
