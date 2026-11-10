import { describe, it, expect } from 'vitest';
import { isEnrolmentStatus, waitOutcome } from '#lib/face-matching-wait.ts';

describe('waitOutcome', () => {
  it('waits while the server says the re-match is queued or running, whatever the counts', () => {
    expect(waitOutcome({ matching: true, photos: 0, toConfirm: 0 })).toBe('waiting');
    expect(waitOutcome({ matching: true, photos: 5, toConfirm: 3 })).toBe('waiting');
  });

  it('offers the faces to check first once the server is done', () => {
    expect(waitOutcome({ matching: false, photos: 4, toConfirm: 2 })).toBe('to_check');
    expect(waitOutcome({ matching: false, photos: 0, toConfirm: 1 })).toBe('to_check');
  });

  it('shows the photos when nothing is to check, and says so when there is nothing', () => {
    expect(waitOutcome({ matching: false, photos: 4, toConfirm: 0 })).toBe('found');
    expect(waitOutcome({ matching: false, photos: 0, toConfirm: 0 })).toBe('none');
  });
});

describe('isEnrolmentStatus', () => {
  it('accepts the route answer and refuses anything else (never read as done)', () => {
    expect(isEnrolmentStatus({ matching: false, photos: 0, toConfirm: 0, success: true })).toBe(
      true
    );
    expect(isEnrolmentStatus({ success: true, enrolled: true })).toBe(false);
    expect(isEnrolmentStatus(null)).toBe(false);
    expect(isEnrolmentStatus('x')).toBe(false);
  });
});
