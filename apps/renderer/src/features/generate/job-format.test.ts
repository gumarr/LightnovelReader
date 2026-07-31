import { describe, expect, it } from 'vitest';
import {
  JOB_PRIORITY_NORMAL,
  JOB_PRIORITY_PREFETCH,
  JOB_PRIORITY_URGENT,
  type Job,
} from '@ln/shared';
import { jobDetail, jobStatusLabel, priorityLabel } from './job-format';

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  type: 'synthesize',
  segmentId: 'seg-1',
  priority: JOB_PRIORITY_NORMAL,
  status: 'queued',
  attempts: 0,
  createdAt: 1000,
  ...overrides,
});

describe('priorityLabel', () => {
  it('dịch ba mức app tự sinh ra', () => {
    expect(priorityLabel(JOB_PRIORITY_URGENT)).toBe('Sắp phát');
    expect(priorityLabel(JOB_PRIORITY_PREFETCH)).toBe('Chuẩn bị trước');
    expect(priorityLabel(JOB_PRIORITY_NORMAL)).toBe('Thường');
  });

  it('số lạ giữ nguyên chứ không ép về "Thường"', () => {
    // Bảng này tồn tại để user thấy job nào đang chắn đường — giấu số thật thì
    // nó mất tác dụng.
    expect(priorityLabel(42)).toBe('Ưu tiên 42');
  });
});

describe('jobStatusLabel', () => {
  it('phân biệt đang chạy với đang chờ', () => {
    expect(jobStatusLabel(job({ status: 'running' }))).toBe('Đang chạy');
    expect(jobStatusLabel(job({ status: 'queued' }))).toBe('Đang chờ');
  });

  it('có nhãn cho cả trạng thái không vào bảng', () => {
    expect(jobStatusLabel(job({ status: 'error' }))).toBe('Lỗi');
    expect(jobStatusLabel(job({ status: 'cancelled' }))).toBe('Đã huỷ');
    expect(jobStatusLabel(job({ status: 'done' }))).toBe('Xong');
  });
});

describe('jobDetail', () => {
  it('job chờ lần đầu không có dòng phụ nào', () => {
    // Hiện "0 lần thử" cho mọi hàng chỉ làm bảng dày lên
    expect(jobDetail(job({ attempts: 0 }))).toBeUndefined();
    expect(jobDetail(job({ attempts: 1 }))).toBeUndefined();
  });

  it('từ lần thử thứ hai mới đáng nói', () => {
    expect(jobDetail(job({ attempts: 2 }))).toBe('đã thử 2 lần');
  });

  it('hiện thông báo lỗi', () => {
    expect(jobDetail(job({ errorMessage: 'Sidecar không trả lời' }))).toBe(
      'Sidecar không trả lời',
    );
  });

  it('ghép cả số lần thử lẫn lỗi', () => {
    expect(jobDetail(job({ attempts: 3, errorMessage: 'Hết giờ chờ' }))).toBe(
      'đã thử 3 lần · Hết giờ chờ',
    );
  });
});
