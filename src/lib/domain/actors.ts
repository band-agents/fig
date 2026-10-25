// The names the system signs its own work with. Events written before the rename carry the old
// names, so every check accepts both and every label shows the new one.

export const AUTOPILOT_NAME = 'Autopilot';
export const RISK_NAME = 'Risk check';
export const SYSTEM_NAME = 'System';
export const PLANNER_NAME = 'AI planner';

const LEGACY: Record<string, string> = { 'Relay Autopilot': AUTOPILOT_NAME, 'Relay Risk': RISK_NAME, Relay: SYSTEM_NAME };

/** The name to print for an actor, old events included. */
export const actorLabel = (name: string) => LEGACY[name] ?? name;

export const isAutopilot = (name: string) => actorLabel(name) === AUTOPILOT_NAME;

/** Work the system did itself, rather than a person, a courier or a store. */
export const isSystemActor = (name: string) => [AUTOPILOT_NAME, RISK_NAME, SYSTEM_NAME, PLANNER_NAME].includes(actorLabel(name));

/** For SQL: every spelling Autopilot has signed with. */
export const AUTOPILOT_NAMES = [AUTOPILOT_NAME, 'Relay Autopilot'];
