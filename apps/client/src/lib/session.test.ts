import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadName, loadSession, saveName, saveSession, type Session } from './session';

const session: Session = {
  gameId: 'game-1',
  code: 'ABC234',
  playerId: 'player-1',
  token: 'token-1',
  mark: 'X',
  name: 'Аня',
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

  it('игнорирует сессию без токена', () => {
    const { token: _token, ...withoutToken } = session;
    sessionStorage.setItem('ttt:session:ABC234', JSON.stringify(withoutToken));

    expect(loadSession('ABC234')).toBeNull();
  });

  it('нормализует код комнаты из хранилища', () => {
    sessionStorage.setItem('ttt:session:ABC234', JSON.stringify({ ...session, code: 'abc234' }));

    expect(loadSession('abc234')?.code).toBe('ABC234');
  });

  it('хранит имя отдельно от сессии', () => {
    saveName('Боб');

    expect(loadName()).toBe('Боб');
    expect(sessionStorage.getItem('ttt:name')).toBeNull();
  });
});
