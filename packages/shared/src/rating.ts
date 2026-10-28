/** Стартовый рейтинг нового аккаунта. */
export const RATING_START = 1000;

/** Ниже этого рейтинг не опускается. */
export const RATING_MIN = 100;

/** Коэффициент Эло: 32 — обычный для быстрых партий. */
export const RATING_K = 32;

/** Ожидаемый счёт первого игрока: 0…1. */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** Новый рейтинг после партии. `score`: 1 — победа, 0.5 — ничья, 0 — поражение. */
export function nextRating(rating: number, opponentRating: number, score: 0 | 0.5 | 1): number {
  const next = Math.round(rating + RATING_K * (score - expectedScore(rating, opponentRating)));
  return Math.max(RATING_MIN, next);
}

/** Изменение рейтинга: удобно показывать в истории (`+12`, `−8`). */
export function ratingDelta(rating: number, opponentRating: number, score: 0 | 0.5 | 1): number {
  return nextRating(rating, opponentRating, score) - rating;
}
