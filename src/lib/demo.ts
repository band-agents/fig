/** Demo mode: one-click sign-in as any department and the "reset demo" control. Never on in production
 *  unless RELAY_DEMO=true is set on purpose. */
export const demoMode = () =>
  process.env.RELAY_DEMO === 'true' || (process.env.NODE_ENV !== 'production' && process.env.RELAY_DEMO !== 'false');
