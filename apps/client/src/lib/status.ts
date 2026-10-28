import type { Cell, Mark, PublicGame } from '@ttt/shared';

export type StatusTone = 'idle' | 'wait' | 'turn' | 'win' | 'lose' | 'draw';

export function statusText(game: PublicGame | null, you: Mark | null): string {
  if (!game) return 'Подключаемся…';

  switch (game.status) {
    case 'waiting':
      return 'Ждём соперника…';
    case 'abandoned':
      if (game.winner && game.winner !== 'draw') {
        return game.winner === you ? 'Соперник не вернулся — победа' : 'Партия отменена';
      }
      return 'Партия отменена';
    case 'finished':
      if (game.winner === 'draw') return 'Ничья';
      return game.winner === you ? 'Вы победили!' : 'Вы проиграли';
    case 'playing':
      return game.turn === you ? 'Ваш ход' : 'Ход соперника';
    default:
      return '';
  }
}

export function statusTone(game: PublicGame | null, you: Mark | null): StatusTone {
  if (!game) return 'idle';
  if (game.status === 'waiting') return 'wait';
  if (game.status === 'playing') return 'turn';
  // Партия отменена без победителя — это не поражение, тон должен быть нейтральным.
  if (game.status === 'abandoned' && !game.winner) return 'idle';
  if (game.winner === 'draw') return 'draw';
  if (game.winner === you) return 'win';
  return 'lose';
}

export function cellLabel(cell: Cell, index: number): string {
  if (!cell) return `Клетка ${index + 1}: пусто`;
  return `Клетка ${index + 1}: ${cell === 'X' ? 'крестик' : 'нолик'}`;
}

export function markTitle(mark: Mark | null): string {
  if (mark === 'X') return 'Крестики';
  if (mark === 'O') return 'Нолики';
  return 'Наблюдатель';
}
