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
export { aramexConfigured, aramexOwnAccounts, aramexTrackingUrl, AramexError, classifyUpdate, createShipmentDraft, trackShipments, withClientInfo } from './aramex';
export type { ShipmentDraft, ShipmentOrder, TrackClass, TrackUpdate } from './aramex';
export { cancelConsignment, classifyGmtc, collectedAt, consignmentLabel, createConsignment, createReturnPickup, GMTC_COURIER, gmtcConfigured, gmtcCreateAt, gmtcEnv, GmtcError, trackConsignments } from './gmtc';
export { BOSTA_COURIER, bostaCity, bostaCollected, bostaConfigured, bostaCreateAt, bostaEnv, BostaError, bostaTrackingUrl, classifyBosta, createDelivery, deliveryLabel, terminateDelivery, trackDeliveries } from './bosta';
export { lucidaConfigured, stockByBarcode } from './lucida';
export type { StockFigure } from './lucida';
export { ConnectorError } from './http';
export type * from './types';
