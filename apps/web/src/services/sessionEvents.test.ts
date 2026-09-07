import { describe, expect, it, vi } from 'vitest';
import { notifyPasswordChangeRequired, notifySessionExpired, onPasswordChangeRequired, onSessionExpired } from './sessionEvents';

describe('sessionEvents', () => {
  it('notifies subscribed listeners when a session expires', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    notifySessionExpired();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifySessionExpired();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribed listeners when a password change is required', () => {
    const listener = vi.fn();
    const unsubscribe = onPasswordChangeRequired(listener);
    notifyPasswordChangeRequired();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifyPasswordChangeRequired();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the two signals independent', () => {
    const expiredListener = vi.fn();
    const mustChangeListener = vi.fn();
    onSessionExpired(expiredListener);
    onPasswordChangeRequired(mustChangeListener);

    notifySessionExpired();

    expect(expiredListener).toHaveBeenCalledTimes(1);
    expect(mustChangeListener).not.toHaveBeenCalled();
  });
});
