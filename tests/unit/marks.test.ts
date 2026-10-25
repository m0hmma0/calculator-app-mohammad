import { describe, expect, it } from 'vitest';
import {
  linkAround,
  looksLikeLink,
  marksFromDelta,
  normaliseLink,
  rangeValue,
  runsOf,
} from '@/text/marks';

describe('formatting with a value', () => {
  it('reads colours and links from the shared text, and keeps different ones apart', () => {
    const marks = marksFromDelta([
      { insert: 'red', attributes: { color: '#e03131' } },
      { insert: 'red', attributes: { color: '#e03131' } },
      { insert: 'blue', attributes: { color: 'var(--shape-6)' } },
      { insert: ' ' },
      { insert: 'site', attributes: { link: 'https://example.com/' } },
    ]);
    expect(marks).toEqual([
      { from: 0, to: 6, color: '#e03131' },
      { from: 6, to: 10, color: 'var(--shape-6)' },
      { from: 11, to: 15, link: 'https://example.com/' },
    ]);
    expect(runsOf(marks, 0, 15).map((run) => run.to)).toEqual([6, 10, 11, 15]);
  });

  it('a range has a colour only if every character in it has that colour', () => {
    const marks = [{ from: 0, to: 4, color: '#e03131' }];
    expect(rangeValue(marks, 0, 4, 'color')).toBe('#e03131');
    expect(rangeValue(marks, 2, 6, 'color')).toBeUndefined();
    expect(rangeValue(marks, 2, 2, 'color')).toBeUndefined();
  });

  it('finds the whole link around the caret, at its end included', () => {
    const marks = [{ from: 5, to: 9, link: 'https://example.com/' }];
    const whole = { url: 'https://example.com/', from: 5, to: 9 };
    expect(linkAround(marks, 5)).toEqual(whole);
    expect(linkAround(marks, 7)).toEqual(whole);
    expect(linkAround(marks, 9)).toEqual(whole);
    expect(linkAround(marks, 4)).toBeNull();
    expect(linkAround(marks, 10)).toBeNull();
  });
});

describe('link addresses', () => {
  it('fills in the scheme, and reads an email address as one', () => {
    expect(normaliseLink('example.com/page')).toBe('https://example.com/page');
    expect(normaliseLink('  http://example.com  ')).toBe('http://example.com/');
    expect(normaliseLink('teacher@school.org')).toBe('mailto:teacher@school.org');
  });

  it('refuses anything that is not a web page or an email', () => {
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('data:text/html,<b>hi</b>')).toBeNull();
    expect(normaliseLink('file:///etc/passwd')).toBeNull();
    expect(normaliseLink('not a link')).toBeNull();
    expect(normaliseLink('')).toBeNull();
  });

  it('knows a pasted address from pasted words', () => {
    expect(looksLikeLink('https://example.com/a?b=c')).toBe(true);
    expect(looksLikeLink('www.example.com')).toBe(true);
    expect(looksLikeLink('see https://example.com')).toBe(false);
    expect(looksLikeLink('example')).toBe(false);
  });
});
