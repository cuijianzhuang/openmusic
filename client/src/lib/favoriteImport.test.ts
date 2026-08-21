import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFavoriteImportStats } from './favoriteImport.ts';

test('累计所有导入批次的新增和超限数量', () => {
  const results = [
    ...Array.from({ length: 10 }, () => ({ imported: 500, dropped: 0 })),
    ...Array.from({ length: 10 }, () => ({ imported: 0, dropped: 500 })),
  ];
  const stats = results.reduce(mergeFavoriteImportStats, { imported: 0, dropped: 0 });

  assert.deepEqual(stats, { imported: 5000, dropped: 5000 });
});
