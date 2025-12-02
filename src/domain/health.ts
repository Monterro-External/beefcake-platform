/**
 * Tenant health score, 0-100, shown in Beefcake admin and exported for the CSM
 * team's own reporting. Only platform-side inputs are used here. Support ticket
 * volume and NPS live in other systems and are joined in downstream, so this
 * score must never silently include them.
 *
 * The weights were argued about at length and then set by the CS lead. They are
 * deliberately blunt: the score's job is to sort 340 tenants so a CSM knows who
 * to call, not to be a model.
 */

export interface HealthInputs {
  /** Share of charges that failed on the last completed payment run, 0-1. */
  readonly failedPaymentRate: number;
  /** Cancellations in the last 90 days divided by active members at the start. */
  readonly churnRate90d: number;
  /** Mean booked share of class capacity over the last 30 days, 0-1. */
  readonly classFillRate: number;
  /** Errors attributed to this tenant per 1,000 requests in the last 30 days. */
  readonly errorRatePerThousand: number;
  /** Worst access-sync lag across the tenant's sites, in hours. */
  readonly accessSyncLagHours: number;
  /** Share of members who used the member app in the last 30 days, 0-1. */
  readonly memberAppAdoption: number;
}

export interface HealthComponent {
  readonly key: keyof HealthInputs;
  readonly label: string;
  readonly weight: number;
  /** 0-1, where 1 is healthy. */
  readonly score: number;
  readonly contribution: number;
}

export interface HealthScore {
  readonly score: number;
  readonly band: HealthBand;
  readonly components: readonly HealthComponent[];
}

export type HealthBand = 'green' | 'amber' | 'red';

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Linear score that is 1 at or below `good` and 0 at or above `bad`. */
function lowerIsBetter(value: number, good: number, bad: number): number {
  if (bad === good) return value <= good ? 1 : 0;
  return clamp01((bad - value) / (bad - good));
}

/** Linear score that is 0 at or below `bad` and 1 at or above `good`. */
function higherIsBetter(value: number, bad: number, good: number): number {
  if (bad === good) return value >= good ? 1 : 0;
  return clamp01((value - bad) / (good - bad));
}

const WEIGHTS: Record<keyof HealthInputs, number> = {
  failedPaymentRate: 0.3,
  churnRate90d: 0.25,
  classFillRate: 0.15,
  errorRatePerThousand: 0.15,
  accessSyncLagHours: 0.1,
  memberAppAdoption: 0.05,
};

const LABELS: Record<keyof HealthInputs, string> = {
  failedPaymentRate: 'Failed payments',
  churnRate90d: 'Churn (90 days)',
  classFillRate: 'Class fill rate',
  errorRatePerThousand: 'Error rate',
  accessSyncLagHours: 'Access sync lag',
  memberAppAdoption: 'Member app adoption',
};

export function scoreTenantHealth(inputs: HealthInputs): HealthScore {
  const scores: Record<keyof HealthInputs, number> = {
    failedPaymentRate: lowerIsBetter(inputs.failedPaymentRate, 0.02, 0.12),
    churnRate90d: lowerIsBetter(inputs.churnRate90d, 0.02, 0.15),
    classFillRate: higherIsBetter(inputs.classFillRate, 0.4, 0.85),
    errorRatePerThousand: lowerIsBetter(inputs.errorRatePerThousand, 0.5, 10),
    accessSyncLagHours: lowerIsBetter(inputs.accessSyncLagHours, 6, 72),
    memberAppAdoption: higherIsBetter(inputs.memberAppAdoption, 0.05, 0.5),
  };

  const components: HealthComponent[] = (Object.keys(WEIGHTS) as Array<keyof HealthInputs>).map((key) => {
    const weight = WEIGHTS[key];
    const score = scores[key];
    return { key, label: LABELS[key], weight, score, contribution: weight * score * 100 };
  });

  const score = Math.round(components.reduce((acc, c) => acc + c.contribution, 0));
  return { score, band: bandFor(score), components };
}

export function bandFor(score: number): HealthBand {
  if (score >= 70) return 'green';
  if (score >= 45) return 'amber';
  return 'red';
}
