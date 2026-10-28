import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSession,
  isGameCode,
  loadName,
  loadSession,
  saveName,
  saveSession,
  type Session,
} from './session';

const session: Session = {
  gameId: 'game-1',
  code: 'ABC234',
  playerId: 'player-1',
  mark: 'X',
  mode: 'pvp',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('session', () => {
  it('сохраняет и читает сессию в рамках вкладки', () => {
    saveSession(session);

    expect(loadSession('abc234')).toEqual(session);
    expect(sessionStorage.getItem('ttt:session:ABC234')).not.toBeNull();
    expect(localStorage.getItem('ttt:session:ABC234')).toBeNull();
  });

  it('удаляет сессию по коду', () => {
    saveSession(session);
    clearSession('ABC234');

    expect(loadSession('ABC234')).toBeNull();
  });

  it('игнорирует битый JSON', () => {
    sessionStorage.setItem('ttt:session:ABC234', '{oops');

    expect(loadSession('ABC234')).toBeNull();
  });

  it('игнорирует сессию с невалидной меткой', () => {
    sessionStorage.setItem('ttt:session:ABC234', JSON.stringify({ ...session, mark: 'Z' }));

    expect(loadSession('ABC234')).toBeNull();
  });

  it('игнорирует сессию без playerId', () => {
    const { playerId: _playerId, ...withoutPlayer } = session;
    sessionStorage.setItem('ttt:session:ABC234', JSON.stringify(withoutPlayer));

    expect(loadSession('ABC234')).toBeNull();
  });

  it('нормализует код комнаты из хранилища', () => {
    sessionStorage.setItem('ttt:session:ABC234', JSON.stringify({ ...session, code: 'abc234' }));

    expect(loadSession('abc234')?.code).toBe('ABC234');
  });

  it('нормализует ключ при сохранении и удалении', () => {
    saveSession({ ...session, code: 'abc234' });

    expect(sessionStorage.getItem('ttt:session:ABC234')).not.toBeNull();
    expect(loadSession('ABC234')).not.toBeNull();

    clearSession('abc234');
    expect(sessionStorage.getItem('ttt:session:ABC234')).toBeNull();
  });

  it('не сохраняет сессию с невалидным кодом', () => {
    saveSession({ ...session, code: 'ABC' });
    saveSession({ ...session, code: 'ABC01O' });

    expect(sessionStorage.length).toBe(0);
  });

  it('не читает сессию, если код в хранилище не совпадает с запрошенным', () => {
    sessionStorage.setItem('ttt:session:ABC234', JSON.stringify({ ...session, code: 'XYZ789' }));

    expect(loadSession('ABC234')).toBeNull();
  });

  it('проверяет формат кода комнаты', () => {
    expect(isGameCode('ABC234')).toBe(true);
    expect(isGameCode('abc234')).toBe(false);
    expect(isGameCode('ABC23')).toBe(false);
    expect(isGameCode('ABC23O')).toBe(false);
  });

  it('хранит имя отдельно от сессии', () => {
    saveName('Боб');

    expect(loadName()).toBe('Боб');
    expect(sessionStorage.getItem('ttt:name')).toBeNull();
  });
});
