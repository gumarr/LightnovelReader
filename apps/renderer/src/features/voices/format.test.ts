import { describe, expect, it } from 'vitest';
import {
  downloadPercent,
  engineNote,
  formatBytes,
  langLabel,
  qualityLabel,
  sidecarLabel,
  voiceSpecLabel,
} from './format';

describe('formatBytes', () => {
  it('voice thật ~63 MB hiện đúng đơn vị', () => {
    // Chia sai đơn vị thì "63 MB" thành "63 KB" mà không có gì báo — đây là
    // con số user nhìn để quyết định có tải hay không.
    expect(formatBytes(63_206_154)).toBe('60.3 MB');
  });

  it('byte lẻ', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('kilobyte', () => {
    expect(formatBytes(4860)).toBe('5 KB');
  });

  it('gigabyte', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });

  it('số âm không sinh chuỗi kỳ quặc', () => {
    expect(formatBytes(-1)).toBe('0 MB');
  });

  it('không byte nào', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('downloadPercent', () => {
  it('tính đúng phần trăm', () => {
    expect(downloadPercent(50, 200)).toBe(25);
  });

  it('tổng bằng 0 thì trả 0, không chia cho 0', () => {
    // Khung SSE đầu tiên có thể chưa biết tổng.
    expect(downloadPercent(10, 0)).toBe(0);
  });

  it('chặn trần 100 để thanh không tràn khung', () => {
    expect(downloadPercent(300, 200)).toBe(100);
  });

  it('chặn sàn 0', () => {
    expect(downloadPercent(-5, 200)).toBe(0);
  });
});

describe('nhãn', () => {
  it('chất lượng dịch sang tiếng Việt', () => {
    expect(qualityLabel('medium')).toBe('Trung bình');
    expect(qualityLabel('x_low')).toBe('Rất thấp');
  });

  it('ngôn ngữ dịch sang tiếng Việt', () => {
    expect(langLabel('vi')).toBe('Tiếng Việt');
    expect(langLabel('en')).toBe('Tiếng Anh');
  });

  it('ngôn ngữ lạ giữ nguyên mã', () => {
    expect(langLabel('ja')).toBe('ja');
  });
});

describe('sidecarLabel', () => {
  it('sẵn sàng thì tông ok', () => {
    expect(sidecarLabel('ready', 0).tone).toBe('ok');
  });

  it('đang khởi động KHÔNG phải lỗi', () => {
    // Tô đỏ thì user hoảng vì một thứ sẽ tự hết sau vài giây.
    expect(sidecarLabel('starting', 0).tone).toBe('pending');
  });

  it('đang khởi động lại cũng không phải lỗi, nhưng có nói lần thứ mấy', () => {
    const label = sidecarLabel('restarting', 2);
    expect(label.tone).toBe('pending');
    expect(label.text).toContain('2');
  });

  it('hỏng hẳn mới là lỗi, và nói user phải làm gì', () => {
    const label = sidecarLabel('failed', 3);
    expect(label.tone).toBe('error');
    expect(label.hint).toContain('Khởi động lại');
  });

  it('dừng chủ động không phải lỗi', () => {
    expect(sidecarLabel('stopped', 0).tone).toBe('pending');
  });
});

describe('voiceSpecLabel', () => {
  const piper = {
    engine: 'piper' as const,
    quality: 'medium' as const,
    sampleRate: 22050,
    totalBytes: 63_206_154,
  };
  const vieneu = {
    engine: 'vieneu' as const,
    quality: 'high' as const,
    sampleRate: 48000,
    totalBytes: 255_800_000,
  };

  it('giọng Piper vẫn hiện thang chất lượng như cũ', () => {
    expect(voiceSpecLabel(piper)).toContain('Chất lượng Trung bình');
  });

  it('giọng VieNeu KHÔNG hiện thang chất lượng của Piper', () => {
    // `VoiceQuality` (`x_low`…`high`) lấy từ tên file model Piper. VieNeu không
    // có thang đó — hiện "Chất lượng Cao" cho nó là bịa ra thông tin không có.
    const label = voiceSpecLabel(vieneu);
    expect(label).not.toContain('Chất lượng');
    expect(label).toContain('Giọng tự nhiên');
  });

  it('cả hai đều hiện dung lượng và tần số', () => {
    expect(voiceSpecLabel(piper)).toContain('22050 Hz');
    expect(voiceSpecLabel(vieneu)).toContain('48000 Hz');
    expect(voiceSpecLabel(vieneu)).toContain('MB');
  });
});

describe('engineNote', () => {
  it('giọng Piper không có ghi chú thừa', () => {
    expect(engineNote('piper')).toBeUndefined();
  });

  it('giọng VieNeu nói trước cả cái được lẫn cái mất', () => {
    // Hai điều user sẽ tự phát hiện nếu ta không nói: model dùng chung (nên chỉ
    // tải một lần) và highlight kém chính xác hơn.
    const note = engineNote('vieneu');
    expect(note).toBeDefined();
    expect(note).toContain('dùng chung');
    expect(note).toContain('Highlight');
  });
});
