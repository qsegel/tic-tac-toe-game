import type { Cell, PublicGame } from '@ttt/shared';
import { describe, expect, it } from 'vitest';
import { cellLabel, markTitle, statusText, statusTone } from './status';

function makeGame(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    id: 'game-1',
    code: 'ABC234',
    board: Array<Cell>(9).fill(null),
    players: {
      X: { name: 'Аня', connected: true },
      O: { name: 'Боб', connected: true },
    },
    turn: 'X',
    status: 'playing',
    winner: null,
    winningLine: null,
    version: 1,
    round: 1,
    rematchVotes: [],
    mode: 'pvp',
    botDifficulty: null,
    createdAt: 0,
    ...overrides,
  };
}

describe('statusText', () => {
  it('сообщает об ожидании соперника', () => {
    expect(statusText(makeGame({ status: 'waiting', players: { X: { name: 'Аня', connected: true }, O: null } }), 'X')).toBe(
      'Ждём соперника…',
    );
  });

  it('различает свой ход и ход соперника', () => {
    expect(statusText(makeGame({ turn: 'X' }), 'X')).toBe('Ваш ход');
    expect(statusText(makeGame({ turn: 'O' }), 'X')).toBe('Ход соперника');
  });

  it('показывает результат партии', () => {
    expect(statusText(makeGame({ status: 'finished', winner: 'X' }), 'X')).toBe('Вы победили!');
    expect(statusText(makeGame({ status: 'finished', winner: 'X' }), 'O')).toBe('Вы проиграли');
    expect(statusText(makeGame({ status: 'finished', winner: 'draw' }), 'X')).toBe('Ничья');
  });

  it('объясняет отмену партии', () => {
    expect(statusText(makeGame({ status: 'abandoned', winner: 'X' }), 'X')).toContain('победа');
    expect(statusText(makeGame({ status: 'abandoned', winner: null }), 'X')).toBe('Партия отменена');
  });

  it('работает до загрузки состояния', () => {
    expect(statusText(null, null)).toBe('Подключаемся…');
  });
});

describe('statusTone', () => {
  it('подбирает оттенок под состояние', () => {
    expect(statusTone(makeGame({ status: 'waiting' }), 'X')).toBe('wait');
    expect(statusTone(makeGame({ status: 'playing' }), 'X')).toBe('turn');
    expect(statusTone(makeGame({ status: 'finished', winner: 'X' }), 'X')).toBe('win');
    expect(statusTone(makeGame({ status: 'finished', winner: 'O' }), 'X')).toBe('lose');
    expect(statusTone(makeGame({ status: 'finished', winner: 'draw' }), 'X')).toBe('draw');
    expect(statusTone(null, null)).toBe('idle');
  });

  it('не окрашивает отмену без победителя как поражение', () => {
    expect(statusTone(makeGame({ status: 'abandoned', winner: null }), 'X')).toBe('idle');
    expect(statusTone(makeGame({ status: 'abandoned', winner: 'X' }), 'X')).toBe('win');
    expect(statusTone(makeGame({ status: 'abandoned', winner: 'O' }), 'X')).toBe('lose');
  });
});

describe('cellLabel', () => {
  it('описывает пустую и занятую клетку', () => {
    expect(cellLabel(null, 0)).toBe('Клетка 1: пусто');
    expect(cellLabel('X', 4)).toBe('Клетка 5: крестик');
    expect(cellLabel('O', 8)).toBe('Клетка 9: нолик');
  });
});

describe('markTitle', () => {
  it('называет метки', () => {
    expect(markTitle('X')).toBe('Крестики');
    expect(markTitle('O')).toBe('Нолики');
    expect(markTitle(null)).toBe('Наблюдатель');
  });
});
