'use client';

import { useState } from 'react';
import { OrderActions } from './actions';
import { ReturnDialog } from './return-dialog';
import type { Scopes } from '@/lib/domain/perms';

type Line = { id: string; title: string; size: string | null; image: string | null; quantity: number; unitPrice: number | null; returnable: boolean };

export function ActionBar(p: {
  orderId: string;
  stage: string;
  onHold: boolean;
  scopes: Scopes;
  me: { id: string };
  assigneeId: string | null;
  assignable: { id: string; name: string }[];
  courier: string | null;
  canReturn: boolean;
  canWork: boolean;
  lines: Line[];
  currency: string;
  policy: { label: string; ok: boolean; why: string; storeOnly: boolean };
  canOverride: boolean;
}) {
  const [ret, setRet] = useState(false);
  const deliveredish = p.stage === 'delivered' || p.stage === 'settled';
  return (
    <>
      <OrderActions {...p} canReturn={p.canReturn && deliveredish} onReturn={() => setRet(true)} />
      {ret && <ReturnDialog orderId={p.orderId} lines={p.lines} currency={p.currency} policy={p.policy} canOverride={p.canOverride} onClose={() => setRet(false)} />}
    </>
  );
}
