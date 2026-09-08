import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_MODE_STORAGE_KEY, readStoredColorMode, writeStoredColorMode } from './colorMode.core';

afterEach(() => localStorage.clear());

describe('readStoredColorMode', () => {
  it('defaults to light when nothing is stored', () => {
    expect(readStoredColorMode()).toBe('light');
  });

  it('reads a stored "dark" preference', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    expect(readStoredColorMode()).toBe('dark');
  });

  it('reads a stored "light" preference', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'light');
    expect(readStoredColorMode()).toBe('light');
  });

  it('falls back to light for an invalid stored value', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'blue');
    expect(readStoredColorMode()).toBe('light');
  });

  it('falls back to light for an empty stored value', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, '');
    expect(readStoredColorMode()).toBe('light');
  });

  it('falls back to light when localStorage.getItem throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('storage disabled'); };
    try {
      expect(readStoredColorMode()).toBe('light');
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe('writeStoredColorMode', () => {
  it('persists the mode under the exact documented key', () => {
    writeStoredColorMode('dark');
    expect(localStorage.getItem('daubertHub.colorMode')).toBe('dark');
  });

  it('never throws when localStorage.setItem fails', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('storage disabled'); };
    try {
      expect(() => writeStoredColorMode('dark')).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
