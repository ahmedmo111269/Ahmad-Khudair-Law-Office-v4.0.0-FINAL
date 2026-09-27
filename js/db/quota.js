export async function storageEstimate(){if(!navigator.storage?.estimate)return null;return navigator.storage.estimate()}
export function quotaLevel(e){if(!e?.quota||!e.usage)return'unknown';const p=e.usage/e.quota*100;return p>=95?'critical':p>=85?'high':p>=70?'warning':'normal'}
