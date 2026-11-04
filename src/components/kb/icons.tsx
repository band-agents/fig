import { CircleHelp, CreditCard, MessageSquareQuote, MessagesSquare, Scale, Smartphone, Store, Truck, Undo2, Users, Workflow, type LucideIcon } from 'lucide-react';

// the sections' icons by name, so the section table stays plain data the client can read
export const KB_ICON: Record<string, LucideIcon> = { CircleHelp, CreditCard, MessageSquareQuote, MessagesSquare, Scale, Smartphone, Store, Truck, Undo2, Users, Workflow };

export const tintVar = (tint: string) => `var(--t-${tint})`;
