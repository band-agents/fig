import { requireUser, sendHome } from '@/lib/auth/session';
import { autopilotRules, slaTargets } from '@/lib/engine';
import { can, canSee } from '@/lib/domain/perms';
import { demoMode } from '@/lib/demo';
import { PageHeader } from '@/components/ui/bits';
import { RulesForm } from '@/components/rules/rules-form';
import { StockRuleCard } from '@/components/rules/stock-rule-card';
import { lastStockRuleRun, ruleMode } from '@/lib/stock-rule';
import { StockAiCard } from '@/components/rules/stock-ai-card';
import { stockRules } from '@/lib/stock/core';
import { lastRun } from '@/lib/stock/planner';
import { ago } from '@/lib/format';

export const metadata = { title: 'Rules & SLAs' };

export default async function RulesPage() {
  const me = await requireUser();
  if (!canSee(me, 'rules')) sendHome(me);
  const [sla, auto, lastRuleRun, ai, run] = await Promise.all([slaTargets(), autopilotRules(), lastStockRuleRun(), stockRules(), lastRun()]);
  return (
    <div>
      <PageHeader eyebrow="Setup" title="Rules & SLAs" sub="How long each department has before an order turns late, what Autopilot may clear without a person, and how far the stock planner may go on its own." />
      {can(me, 'settings', 1) && <RulesForm sla={sla} autopilot={auto} canEdit={can(me, 'settings', 2)} demo={demoMode() && me.role === 'admin'} />}
      {can(me, 'stock', 1) && <StockAiCard rules={ai} canEdit={can(me, 'stock', 3)} lastRun={run ? ago(run.at) : null} />}
      {can(me, 'settings', 1) && <StockRuleCard mode={ruleMode()} last={lastRuleRun} canRun={can(me, 'settings', 2)} />}
    </div>
  );
}
