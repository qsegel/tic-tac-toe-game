import { describe, expect, it } from 'vitest';
import { safeRedirect } from './router';

describe('safeRedirect', () => {
  it('пропускает внутренние пути', () => {
    expect(safeRedirect('/')).toBe('/');
    expect(safeRedirect('/game/ABC234')).toBe('/game/ABC234');
    expect(safeRedirect('/profile?tab=history#top')).toBe('/profile?tab=history#top');
    expect(safeRedirect('/author')).toBe('/author');
  });

  it('отклоняет внешние адреса и опасные схемы', () => {
    expect(safeRedirect('https://evil.example')).toBeNull();
    expect(safeRedirect('//evil.example')).toBeNull();
    expect(safeRedirect('/\\evil.example')).toBeNull();
    expect(safeRedirect('/%5Cevil.example')).toBeNull();
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect(42)).toBeNull();
    expect(safeRedirect(null)).toBeNull();
  });

  it('отклоняет управляющие символы', () => {
    expect(safeRedirect('/game/\u0000ABC234')).toBeNull();
    expect(safeRedirect('/game/\u007f')).toBeNull();
  });

  it('не отправляет обратно на страницу входа', () => {
    expect(safeRedirect('/auth')).toBeNull();
    expect(safeRedirect('/auth?mode=login')).toBeNull();
    expect(safeRedirect('/AUTH/')).toBeNull();
    expect(safeRedirect('/%61uth')).toBeNull();
  });

  it('отклоняет битое процентное кодирование', () => {
    expect(safeRedirect('/%E0%A4%A')).toBeNull();
  });
});
