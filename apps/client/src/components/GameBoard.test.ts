import type { Cell } from '@ttt/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GameBoard from './GameBoard.vue';

function emptyBoard(): Cell[] {
  return Array<Cell>(9).fill(null);
}

describe('GameBoard', () => {
  it('рендерит девять клеток', () => {
    const wrapper = mount(GameBoard, { props: { board: emptyBoard() } });
    expect(wrapper.findAll('button')).toHaveLength(9);
  });

  it('эмитит индекс при клике по пустой клетке', async () => {
    const wrapper = mount(GameBoard, { props: { board: emptyBoard() } });
    await wrapper.findAll('button')[4]!.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[4]]);
  });

  it('не эмитит, когда доска заблокирована', async () => {
    const wrapper = mount(GameBoard, { props: { board: emptyBoard(), disabled: true } });
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('не эмитит по занятой клетке', async () => {
    const board = emptyBoard();
    board[0] = 'X';
    const wrapper = mount(GameBoard, { props: { board } });
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('показывает метки и подсвечивает выигрышную линию', () => {
    const board = emptyBoard();
    board[0] = 'X';
    board[1] = 'X';
    board[2] = 'X';
    board[4] = 'O';

    const wrapper = mount(GameBoard, { props: { board, winningLine: [0, 1, 2] } });

    expect(wrapper.findAll('.cell--x')).toHaveLength(3);
    expect(wrapper.findAll('.cell--o')).toHaveLength(1);
    expect(wrapper.findAll('.cell--win')).toHaveLength(3);
  });

  it('aria-label описывает клетку', () => {
    const board = emptyBoard();
    board[0] = 'O';
    const wrapper = mount(GameBoard, { props: { board } });
    const buttons = wrapper.findAll('button');

    expect(buttons[0]!.attributes('aria-label')).toBe('Клетка 1: нолик');
    expect(buttons[1]!.attributes('aria-label')).toBe('Клетка 2: пусто');
  });
});
