import 'server-only';
// The connector for each storefront platform, plus the courier (Aramex) and ERP (Lucida) clients.
import type { ChannelDef } from '../channels';
import type { Connector } from './types';
import { medusa } from './medusa';
import { shopify } from './shopify';
import { woo } from './woo';

export function connectorFor(c: ChannelDef): Connector | null {
  switch (c.platform) {
    case 'shopify':
      return shopify;
    case 'medusa':
      return medusa;
    case 'woo':
      return woo;
    default:
      return null;
  }
}

export { medusa, shopify, woo };
export { aramexConfigured, aramexTrackingUrl, AramexError, classifyUpdate, createShipmentDraft, trackShipments, withClientInfo } from './aramex';
export type { ShipmentDraft, ShipmentOrder, TrackClass, TrackUpdate } from './aramex';
export { lucidaConfigured, stockByBarcode } from './lucida';
export type { StockFigure } from './lucida';
export { ConnectorError } from './http';
export type * from './types';
