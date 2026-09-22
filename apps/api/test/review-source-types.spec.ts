import { describe, expect, it } from 'vitest';
import { REVIEW_SUPPORTED_AUTOMATION_CODES } from '../src/automations/review/review-source-types';

describe('REVIEW_SUPPORTED_AUTOMATION_CODES (Phase 12A.4c)', () => {
  it('supports exactly the two automations actually wired into the review subsystem', () => {
    expect([...REVIEW_SUPPORTED_AUTOMATION_CODES].sort()).toEqual(['PAYMENT_NOTIFICATIONS', 'REMISIONES_AUDI']);
  });

  // The motivating case: Caterpillar is fully INTEGRATED into the Hub (Phase 12A.4b) but was
  // never wired into ReviewAcknowledgementsService.findProblem() and has no
  // review-source-type constant — integrationStatus and review support are independent facts,
  // and this registration is never derived from AUTOMATION_CATALOG.integrationStatus.
  it('does not include REMISIONES_CATERPILLAR, despite it being INTEGRATED', () => {
    expect(REVIEW_SUPPORTED_AUTOMATION_CODES.has('REMISIONES_CATERPILLAR')).toBe(false);
  });

  it('does not include an unknown/future automation code by default', () => {
    expect(REVIEW_SUPPORTED_AUTOMATION_CODES.has('SOME_FUTURE_AUTOMATION')).toBe(false);
  });
});
