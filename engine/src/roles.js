// Galahad roles — the three built-in personas of the team.
// A role is pure configuration: the same engine binary runs any of them.
// Swap the SOUL markdown (roles/<key>.md) and these defaults to make your own.
//
// - chef      : orchestrator & human-facing coordinator. Delegates the heavy
//               work (to the Claude bridge or to the traveler).
// - guardian  : cheap, reactive health patrol + code QA. Wakes the brain only
//               on an anomaly. Read-mostly.
// - traveler  : autonomous explorer & night-shift builder. Pursues goals,
//               reports findings, asks for a "yes" before committing anything.

export const ROLES = {
  chef: {
    key: 'chef',
    defaultName: 'Chef',
    title: 'Orchestrator',
    defaultModel: process.env.GALAHAD_MODEL_CHEF || 'gpt-oss:120b',
    heartbeatMinutes: 0, // no autonomous loop by default — chef is human-driven
    capabilities: ['coordinate', 'delegate', 'chat'],
    canAct: true,
  },
  guardian: {
    key: 'guardian',
    defaultName: 'Guardian',
    title: 'Health patrol & QA',
    defaultModel: process.env.GALAHAD_MODEL_GUARDIAN || 'deepseek-v4-flash',
    heartbeatMinutes: 5,
    capabilities: ['patrol', 'inspect', 'report'],
    canAct: true,
  },
  traveler: {
    key: 'traveler',
    defaultName: 'Traveler',
    title: 'Autonomous explorer & builder',
    defaultModel: process.env.GALAHAD_MODEL_TRAVELER || 'deepseek-v4-pro',
    heartbeatMinutes: 30,
    capabilities: ['explore', 'goals', 'build'],
    canAct: true,
  },
}
