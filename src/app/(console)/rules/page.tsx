import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { autopilotRules, slaTargets } from '@/lib/engine';
import { can } from '@/lib/domain/perms';
import { demoMode } from '@/lib/demo';
import { PageHeader } from '@/components/ui/bits';
import { RulesForm } from '@/components/rules/rules-form';
import { StockRuleCard } from '@/components/rules/stock-rule-card';
import { lastStockRuleRun, ruleMode } from '@/lib/stock-rule';

export const metadata = { title: 'Rules & SLAs' };

export default async function RulesPage() {
  const me = await requireUser();
  if (!can(me, 'settings', 1)) notFound();
  const [sla, auto, lastRun] = await Promise.all([slaTargets(), autopilotRules(), lastStockRuleRun()]);
  return (
    <div>
      <PageHeader eyebrow="Setup" title="Rules & SLAs" sub="How long each department has before an order turns late, and what Autopilot may clear without a person. Changes apply to the next stage change, and every automatic step says why on the timeline." />
      <RulesForm sla={sla} autopilot={auto} canEdit={can(me, 'settings', 2)} demo={demoMode() && me.role === 'admin'} />
      <StockRuleCard mode={ruleMode()} last={lastRun} canRun={can(me, 'settings', 2)} />
    </div>
  );
}
