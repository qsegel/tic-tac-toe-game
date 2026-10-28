import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RATING_K,
  RATING_MIN,
  RATING_START,
  expectedScore,
  nextRating,
  ratingDelta,
} from '../src/rating.js';

test('expectedScore: равные рейтинги дают 0.5', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
});

test('expectedScore: фаворит ожидает больше очков', () => {
  assert.ok(expectedScore(1200, 1000) > 0.5);
  assert.ok(expectedScore(1000, 1200) < 0.5);
});

test('nextRating: победа и поражение при равных рейтингах симметричны', () => {
  assert.equal(nextRating(1000, 1000, 1), 1000 + RATING_K / 2);
  assert.equal(nextRating(1000, 1000, 0), 1000 - RATING_K / 2);
  assert.equal(nextRating(1000, 1000, 0.5), 1000);
});

test('nextRating: андердог получает больше за победу', () => {
  const underdog = ratingDelta(1000, 1400, 1);
  const favorite = ratingDelta(1400, 1000, 1);
  assert.ok(underdog > favorite);
});

test('nextRating: рейтинг не опускается ниже минимума', () => {
  assert.equal(nextRating(RATING_MIN, 3000, 0), RATING_MIN);
});

test('nextRating: стартовый рейтинг по умолчанию', () => {
  assert.equal(RATING_START, 1000);
  assert.equal(ratingDelta(RATING_START, RATING_START, 1), 16);
});
