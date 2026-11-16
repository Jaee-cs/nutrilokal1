import { describe, expect, it } from 'vitest';
import { dashboardPeriodCodes } from './lib/date';

describe('dashboardPeriodCodes', () => {
  it('hari ini memakai tanggal bisnis WIB berjalan', () => {
    // 12 Nov 2026 18:30 UTC = 13 Nov 2026 01:30 WIB.
    const reference = new Date('2026-11-12T18:30:00.000Z');
    expect(dashboardPeriodCodes('today', reference)).toEqual({
      from: '2026-11-13',
      to: '2026-11-13',
    });
  });

  it('minggu ini adalah 7 hari terakhir termasuk hari ini', () => {
    const reference = new Date('2026-11-13T05:00:00.000Z');
    expect(dashboardPeriodCodes('week', reference)).toEqual({
      from: '2026-11-07',
      to: '2026-11-13',
    });
  });

  it('bulan ini adalah 30 hari terakhir termasuk hari ini', () => {
    const reference = new Date('2026-11-13T05:00:00.000Z');
    expect(dashboardPeriodCodes('month', reference)).toEqual({
      from: '2026-10-15',
      to: '2026-11-13',
    });
  });

  it('periode bergulir melewati pergantian tahun dengan benar', () => {
    const reference = new Date('2026-01-01T05:00:00.000Z');
    expect(dashboardPeriodCodes('week', reference)).toEqual({
      from: '2025-12-26',
      to: '2026-01-01',
    });
    expect(dashboardPeriodCodes('month', reference)).toEqual({
      from: '2025-12-03',
      to: '2026-01-01',
    });
  });

  it('periode tidak bergantung pada awal minggu atau awal bulan kalender', () => {
    const sunday = new Date('2026-11-15T05:00:00.000Z');
    const monday = new Date('2026-11-16T05:00:00.000Z');
    expect(dashboardPeriodCodes('week', sunday)).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
    });
    expect(dashboardPeriodCodes('week', monday)).toEqual({
      from: '2026-11-10',
      to: '2026-11-16',
    });
  });
});
