import { ArrowRightLeft, BadgePercent, ClipboardCheck, Hourglass, Megaphone, PackagePlus, Plane, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';

/** What each kind of proposal is called, its colour and icon, and the button that accepts it. */
export const KIND: Record<string, { label: string; icon: LucideIcon; tint: string; verb: string; team: string }> = {
  reorder: { label: 'Reorder', icon: PackagePlus, tint: 'cyan', verb: 'Add to purchase order', team: 'Buying' },
  expedite: { label: 'Bring forward', icon: Plane, tint: 'red', verb: 'Chase the supplier', team: 'Buying' },
  markdown: { label: 'Markdown', icon: BadgePercent, tint: 'rose', verb: 'Approve the markdown', team: 'Stock' },
  transfer: { label: 'Transfer', icon: ArrowRightLeft, tint: 'violet', verb: 'Create the transfer', team: 'Stock' },
  cross_sell: { label: 'Cross-sell', icon: Megaphone, tint: 'green', verb: 'Publish to the website', team: 'Websites' },
  upsell: { label: 'Upsell', icon: TrendingUp, tint: 'green', verb: 'Publish to the website', team: 'Websites' },
  popup: { label: 'Pop-up', icon: Sparkles, tint: 'green', verb: 'Publish to the website', team: 'Websites' },
  bundle: { label: 'Bundle', icon: Megaphone, tint: 'green', verb: 'Publish to the website', team: 'Websites' },
  count: { label: 'Cycle count', icon: ClipboardCheck, tint: 'amber', verb: 'Schedule the count', team: 'Warehouse' },
  // not a proposal: the planner's reason for leaving a season's last pieces alone
  sellout: { label: 'Let it sell out', icon: Hourglass, tint: 'neutral', verb: '', team: 'Stock' },
};
