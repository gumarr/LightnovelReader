/**
 * Kiểm UI trong app **đang chạy thật** bằng CDP — một lệnh, không sửa file tạm.
 *
 *     pnpm ui-check              # bản dev (apps/main + vite)
 *     pnpm ui-check --packaged   # bản đã `pnpm build:win`
 *
 * **Vì sao script này tồn tại.** Sáu lần trong dự án này unit test xanh mà UI vẫn
 * hỏng (PROGRESS mục 4.19, 4.22, 4.23, 4.43…). Hai loại lỗi không có cách nào bắt
 * bằng vitest, vì jsdom không tính CSS thật và không tính layout:
 *
 * - **Màu trong suốt** (mục 4.23): `bg-accent/30` âm thầm mất màu khi biến CSS lưu
 *   hex thay vì kênh RGB. jsdom trả lại đúng chuỗi class nên test không thấy gì.
 * - **Chiều cao bằng 0** (mục 4.43): `clientHeight` luôn 0 trong jsdom, nên danh
 *   sách segment bị cắt mất nửa dưới nằm im từ P1.6c tới P2.7.
 *
 * Vì vậy mọi phép kiểm ở đây phải là **số đo lấy từ Chromium thật**, không phải
 * sự có mặt của một class. Trước script này quy trình là gõ tay `Runtime.evaluate`
 * vào file tạm rồi xoá — lần thứ năm làm lại từ đầu (nợ mục 8, mức Cao).
 *
 * Chạy được ở cả hai bản là điều kiện bắt buộc: bản dev thấy CSS thật và IPC thật
 * nhưng **không** lộ lỗi đường dẫn kiểu asar (mục 4.19, 4.29a), nên bản đóng gói
 * mới là nơi kết luận.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const keepOpen = process.argv.includes('--keep-open');
const shotDir = join(root, 'artifacts', 'ui-check');

const DEBUG_PORT = 9222;

/**
 * Hạn chờ renderer xuất hiện trên cổng debug.
 *
 * Bản dev rộng hơn nhiều vì `dev.mjs` còn phải build xong main + preload +
 * renderer trước khi Electron mở cửa sổ — đo thật trên máy dev là ~35s chỉ riêng
 * bundle SSR 1.7 MB, chưa tính lần chạy nguội. Bản đóng gói thì mở là chạy ngay.
 */
const READY_TIMEOUT_MS = packaged ? 90_000 : 240_000;

/* ------------------------------------------------------------------ tiện ích */

const log = (message) => console.log(`[ui-check] ${message}`);

/** Số phép kiểm hỏng. Không dừng ở lỗi đầu: một lượt chạy nên báo hết. */
let failures = 0;

const pass = (name, detail) => log(`  ✅ ${name}${detail === undefined ? '' : ` — ${detail}`}`);

const fail = (name, detail) => {
  failures += 1;
  console.error(`[ui-check]   ❌ ${name} — ${detail}`);
};

/** Kiểm một điều kiện, luôn in ra số đo thật để đọc được cả khi nó đúng. */
const check = (name, ok, detail) => {
  if (ok) pass(name, detail);
  else fail(name, detail);
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Chờ có điều kiện thay vì `sleep` cứng.
 *
 * Máy chậm thì sleep cố định fail giả, máy nhanh thì phí thời gian — bài học đã
 * ghi trong bước smoke test của CI.
 */
const waitFor = async (label, probe, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined && value !== null && value !== false) return value;
      last = value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Hết ${timeoutMs}ms chờ ${label} (lần cuối: ${JSON.stringify(last)})`);
};

/* ------------------------------------------------------ khởi động app + CDP */

/** Tìm file thực thi của bản đóng gói. */
const packagedExe = () => {
  const candidates = [
    join(root, 'release', 'win-unpacked', 'LN Reader.exe'),
    join(root, 'release', 'LN Reader.exe'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      [
        'Không thấy bản đóng gói. Dựng bằng:',
        '  pnpm build:win',
        'Đã tìm ở:',
        ...candidates.map((c) => `  ${c}`),
      ].join('\n'),
    );
  }
  return found;
};

/**
 * Tráo `better_sqlite3.node` sang bản ABI của Electron.
 *
 * **Bắt buộc, và đây là lỗi đã gặp thật khi viết script này.** `pnpm test` để lại
 * bản ABI của Node (127), còn Electron 33 cần 130. Chạy `dev.mjs` thẳng mà không
 * qua `pnpm dev` thì bỏ mất bước `abi:electron`: app khởi động, **cửa sổ không bao
 * giờ mở**, `/json/version` vẫn trả lời bình thường trong khi `/json/list` rỗng.
 * Nhìn từ ngoài giống hệt "renderer nạp chậm" — lý do thật chỉ nằm ở
 * `%APPDATA%/LN Reader/logs/crash.log`.
 *
 * Bản đóng gói không cần bước này: nó mang `.node` riêng đã build cho Electron.
 */
const ensureElectronAbi = () => {
  log('Tráo better-sqlite3 sang ABI của Electron');
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'sqlite-abi.mjs'), 'electron'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Không tráo được ABI cho Electron (mã ${result.status})`);
  }
};

const launch = () => {
  // ELECTRON_RUN_AS_NODE khiến Electron chạy như Node thuần → không mở cửa sổ
  // nào. Terminal của VS Code luôn đặt biến này (PROGRESS mục 5.2), nên phải xoá
  // hẳn khỏi env truyền xuống, không thì script treo ở bước chờ renderer.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  if (packaged) {
    const exe = packagedExe();
    log(`Mở bản đóng gói: ${exe}`);
    return spawn(exe, [`--remote-debugging-port=${DEBUG_PORT}`], {
      env,
      stdio: 'ignore',
      detached: false,
    });
  }

  ensureElectronAbi();

  log('Mở bản dev (scripts/dev.mjs)');
  return spawn(
    process.execPath,
    [join(root, 'scripts', 'dev.mjs')],
    // Cổng debug đi qua biến môi trường: `dev.mjs` tự truyền xuống Electron.
    { env: { ...env, LN_REMOTE_DEBUG_PORT: String(DEBUG_PORT) }, cwd: root, stdio: 'inherit' },
  );
};

/**
 * In `crash.log` của app nếu có.
 *
 * Cửa sổ không mở được thì `/json/version` **vẫn** trả lời (tiến trình browser
 * sống) trong khi `/json/list` rỗng — từ ngoài trông y như renderer nạp chậm. Lý
 * do thật luôn nằm ở đây, nên script phải tự đọc thay vì để người đi tìm.
 */
const printCrashLog = () => {
  const appData = process.env.APPDATA;
  if (appData === undefined) return;

  const crash = join(appData, 'LN Reader', 'logs', 'crash.log');
  if (!existsSync(crash)) return;

  console.error(`[ui-check] --- ${crash} (20 dòng cuối) ---`);
  const lines = readFileSync(crash, 'utf8').trimEnd().split('\n');
  for (const line of lines.slice(-20)) console.error(`[ui-check]   ${line}`);
};

/** Chờ target `page` của renderer xuất hiện trên cổng debug. */
const findPageTarget = async () => {
  try {
    return await waitFor(
      'renderer nạp được',
      async () => {
        const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await response.json();
        // Bỏ devtools và các target không phải trang chính.
        return targets.find(
          (target) => target.type === 'page' && !target.url.startsWith('devtools://'),
        );
      },
      READY_TIMEOUT_MS,
    );
  } catch (error) {
    printCrashLog();
    throw error;
  }
};

/** Kết nối CDP tối giản. Chỉ cần `Runtime.evaluate` + `Page.captureScreenshot`. */
const connect = async (wsUrl) => {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', () => reject(new Error('Không mở được WebSocket CDP')), {
      once: true,
    });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const send = (method, params) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => {
        if (pending.delete(id)) rej(new Error(`CDP ${method} quá 60s không trả lời`));
      }, 60_000);
    });
  };

  /**
   * Chạy biểu thức trong renderer và trả về giá trị đã tuần tự hoá.
   *
   * `awaitPromise` để gọi được `window.api.*` (mọi IPC đều async).
   * `returnByValue` để lấy object thật chứ không phải handle.
   */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails !== undefined) {
      const text =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'lỗi';
      throw new Error(`Renderer ném: ${text}`);
    }
    return result.result.value;
  };

  /**
   * Chụp ảnh — **không** để hỏng cả lượt chạy.
   *
   * `Page.captureScreenshot` treo vô hạn khi cửa sổ bị che hoàn toàn hoặc thu nhỏ
   * (Chromium không có surface để đọc). Ảnh chỉ là bằng chứng để người xem lại,
   * còn kết luận nằm ở các số đo — mất ảnh không được phép làm đỏ phép kiểm nào.
   */
  const screenshot = async (name) => {
    try {
      const { data } = await Promise.race([
        send('Page.captureScreenshot', { format: 'png' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('chụp ảnh quá 15s')), 15_000),
        ),
      ]);
      mkdirSync(shotDir, { recursive: true });
      const file = join(shotDir, `${name}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    } catch (error) {
      log(`  (bỏ qua ảnh ${name}: ${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  };

  return { evaluate, screenshot, close: () => socket.close() };
};

/* -------------------------------------------------------- thao tác trên UI */

/**
 * Bấm phần tử theo `data-testid`. Trả `false` khi không có phần tử nào.
 *
 * Nếu chính phần tử đó không bấm được thì tìm `<button>`/`<a>` **bên trong**:
 * `chapter-item` chẳng hạn nằm trên `<li>` còn `onClick` nằm trên `<button>` con,
 * nên `li.click()` không kích hoạt gì cả — không lỗi, chỉ im lặng không xảy ra gì.
 */
const clickTestId = (testId, index = 0) => `
  (() => {
    const nodes = document.querySelectorAll('[data-testid="${testId}"]');
    if (nodes.length <= ${index}) return false;
    const node = nodes[${index}];
    const target =
      node.tagName === 'BUTTON' || node.tagName === 'A'
        ? node
        : (node.querySelector('button, a') ?? node);
    target.click();
    return true;
  })()
`;

/**
 * Đổi theme bằng cách **bấm nút thật**, không sửa `classList` bằng tay.
 *
 * Sửa class trực tiếp sẽ kiểm sai thứ: ta cần biết đường đi thật (nút →
 * `setTheme` → IPC → settings → `applyTheme` → biến CSS) có ra đúng màu không.
 * Nút xoay vòng Sáng → Tối → Theo hệ thống nên bấm tối đa 3 lần là tới.
 *
 * Dùng `data-theme-resolved` chứ không `data-theme-mode`: chế độ `system` phân
 * giải ra sáng hay tối tuỳ máy, mà ta cần biết màu **đang hiển thị**.
 */
const clickThemeUntil = (theme) => `
  (async () => {
    const button = document.querySelector('[data-theme-resolved]');
    if (button === null) return 'không thấy nút theme';

    for (let i = 0; i < 4; i += 1) {
      if (button.dataset.themeResolved === '${theme}') return 'ok';
      button.click();
      await new Promise((done) => setTimeout(done, 250));
    }
    return button.dataset.themeResolved === '${theme}' ? 'ok' : 'không đổi được';
  })()
`;

/* ----------------------------------------------------------- phép kiểm màu */

/**
 * Đo màu tính ra được của các token, ở theme đang bật.
 *
 * Đây là lưới chặn lỗi 4.23: biến CSS phải lưu **kênh RGB** để `rgb(var(--x))` và
 * `bg-accent/30` còn dùng được. Nếu ai đổi về hex thì `alpha` ở đây thành 0 và
 * script đỏ. Kiểm bằng cách dựng phần tử thật rồi đọc `getComputedStyle`, không
 * đọc lại chuỗi biến — chuỗi biến sai vẫn "có mặt".
 */
const measureColors = `
  (() => {
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.left = '-9999px';
    document.body.appendChild(probe);

    const read = (className) => {
      probe.className = className;
      const value = getComputedStyle(probe).backgroundColor;
      return value;
    };

    // Vừa màu đặc vừa màu có alpha: 4.23 chỉ lộ ra ở nhánh có alpha.
    //
    // CHỈ dùng class CÓ THẬT trong mã nguồn. Tailwind JIT sinh CSS theo những gì
    // nó quét thấy trong src/**, nên một class ta tự nghĩ ra ở đây (ví dụ
    // bg-accent/30) sẽ không tồn tại và luôn đo ra rgba(0, 0, 0, 0) — đỏ giả,
    // đúng cái bẫy đã mất một lượt chạy để nhận ra.
    //
    // bg-accent/10 là class thật, dùng ở SegmentList (dòng segment đang chọn) và ở
    // StorageBookRow. Đây chính là chỗ lỗi 4.23 làm mất màu.
    const result = {
      accent: read('bg-accent'),
      accentAlpha10: read('bg-accent/10'),
      accentAlpha5: read('bg-accent/5'),
      danger: read('bg-danger'),
      bgElevated: read('bg-bg-elevated'),
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    };
    probe.remove();
    return result;
  })()
`;

/** `rgba(0, 0, 0, 0)` hoặc alpha 0 nghĩa là màu đã mất — đúng triệu chứng 4.23. */
const isTransparent = (color) =>
  color === undefined ||
  color === '' ||
  color === 'transparent' ||
  color === 'rgba(0, 0, 0, 0)' ||
  /rgba\([^)]*,\s*0\)$/.test(color);

const checkColors = async (cdp, theme) => {
  // Nút theme nằm trong titlebar do React dựng — có thể chưa mount xong ở lượt
  // gọi đầu. Chờ nó xuất hiện thay vì kết luận "không thấy nút" (đã đỏ giả một lần).
  await waitFor('nút theme xuất hiện', async () =>
    cdp.evaluate(`document.querySelector('[data-theme-resolved]') !== null`),
  );

  const switched = await cdp.evaluate(clickThemeUntil(theme));
  if (switched !== 'ok') {
    fail(`đổi theme sang ${theme}`, switched);
    return { accent: '', theme };
  }

  await waitFor(`theme đổi sang ${theme}`, async () => {
    const current = await cdp.evaluate(
      `document.documentElement.classList.contains('dark') ? 'dark' : 'light'`,
    );
    return current === theme ? current : undefined;
  });

  const colors = await cdp.evaluate(measureColors);
  log(`Màu ở theme ${theme}:`);

  for (const [token, value] of Object.entries(colors)) {
    if (token === 'theme') continue;
    check(`${token} không trong suốt`, !isTransparent(value), value);
  }

  // Hai theme phải khác nhau thật — nếu giống hệt thì lớp theme không có tác dụng
  // và ta đang kiểm cùng một thứ hai lần.
  return colors;
};

/* -------------------------------------------------- phép kiểm bố cục/chiều cao */

/**
 * Đo ô cuộn danh sách segment: chiều cao thật + số dòng đã render.
 *
 * Đây là lưới chặn lỗi 4.43. Hai số, hai cách hỏng khác nhau:
 *
 * - `clientHeight` nhỏ so với panel → thiếu `flex-1 min-h-0` ở khối bọc (lỗi 1).
 * - `clientHeight` đủ mà `rows` vẫn ít → `useEffect` đo sai lúc (lỗi 2). Chính
 *   đây là chỗ bản sửa đầu tiên vẫn còn hỏng: 764/811 px mà chỉ 4 dòng.
 */
const measureSegmentList = `
  (() => {
    const scroll = document.querySelector('[data-testid="segment-scroll"]');
    const panel = document.querySelector('[data-testid="segment-panel"]');
    if (scroll === null || panel === null) return null;
    return {
      scrollHeight: scroll.clientHeight,
      panelHeight: panel.clientHeight,
      rows: document.querySelectorAll('[data-testid="segment-row"]').length,
      scrollable: scroll.scrollHeight,
    };
  })()
`;

const checkSegmentLayout = async (cdp) => {
  const measured = await waitFor(
    'danh sách segment render',
    async () => {
      const value = await cdp.evaluate(measureSegmentList);
      return value !== null && value.rows > 0 ? value : undefined;
    },
    30_000,
  );

  log('Bố cục danh sách đoạn:');

  // Ô cuộn phải cao gần bằng panel. Ngưỡng 0.7: panel còn chứa khối
  // GenerateControls ở trên, nên không thể bằng 100%.
  const ratio = measured.scrollHeight / Math.max(measured.panelHeight, 1);
  check(
    'ô cuộn cao gần bằng panel (không bị co theo nội dung)',
    ratio > 0.7,
    `${measured.scrollHeight}/${measured.panelHeight} px = ${(ratio * 100).toFixed(0)}%`,
  );

  // Không lấy `clientHeight` làm mốc mà không kiểm chính nó: jsdom trả 0 và mọi
  // phép chia đều "đúng" một cách vô nghĩa.
  check('ô cuộn có chiều cao thật', measured.scrollHeight > 200, `${measured.scrollHeight} px`);

  // Số dòng phải xấp xỉ chiều cao / ROW_HEIGHT(64) + overscan. Đây là số đã bắt
  // được lỗi thật: 4 dòng trong khung 764 px.
  const expected = Math.floor(measured.scrollHeight / 64);
  check(
    'số dòng khớp chiều cao khung',
    measured.rows >= expected,
    `${measured.rows} dòng, khung chứa được ~${expected}`,
  );

  return measured;
};

/**
 * Ẩn rồi hiện lại panel: hai đường phải cho **cùng chiều cao đo được**.
 *
 * Lỗi 4.43 lộ ra đúng ở chênh lệch này — dựng lại component sau khi layout đã
 * xong cho kết quả đúng, còn lần đầu thì không. Bằng nhau nghĩa là thứ tự khởi
 * tạo không còn quyết định kết quả.
 *
 * **So `clientHeight`, không so số dòng.** Số dòng render phụ thuộc `scrollTop`:
 * ở đầu danh sách thì overscan bị cắt một phía (13 dòng), ở giữa thì đủ cả hai
 * phía (10 dòng) — cả hai đều **đúng**. So số dòng qua hai vị trí cuộn khác nhau
 * là so hai thứ không so được, và nó đã đỏ giả một lượt. Chiều cao khung mới là
 * đại lượng lỗi 4.43 làm sai, và nó không phụ thuộc vị trí cuộn.
 */
const checkSegmentToggle = async (cdp, first) => {
  const toggled = await cdp.evaluate(`
    (() => {
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons.find((b) => /Ẩn đoạn|Hiện đoạn/.test(b.textContent ?? ''));
      if (button === undefined) return false;
      button.click();
      return true;
    })()
  `);

  if (toggled !== true) {
    fail('tìm nút ẩn/hiện đoạn', 'không thấy nút nào có chữ "Ẩn đoạn"/"Hiện đoạn"');
    return;
  }

  await sleep(300);
  await cdp.evaluate(`
    (() => {
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons.find((b) => /Ẩn đoạn|Hiện đoạn/.test(b.textContent ?? ''));
      button?.click();
      return true;
    })()
  `);

  const again = await waitFor('panel hiện lại', async () => {
    const value = await cdp.evaluate(measureSegmentList);
    return value !== null && value.rows > 0 ? value : undefined;
  });

  check(
    'ẩn/hiện lại cho cùng chiều cao khung',
    again.scrollHeight === first.scrollHeight,
    `lần đầu ${first.scrollHeight} px, sau khi hiện lại ${again.scrollHeight} px`,
  );

  // Và số dòng vẫn phải đủ so với khung — bắt được ca "chiều cao đúng mà `height`
  // trong state vẫn 0", tức lỗi thứ hai của 4.43.
  const expected = Math.floor(again.scrollHeight / 64);
  check(
    'sau khi hiện lại vẫn đủ dòng',
    again.rows >= expected,
    `${again.rows} dòng, khung chứa được ~${expected}`,
  );
};

/* ------------------------------------------------------- phép kiểm viewer PDF */

/**
 * Canvas PDF phải có pixel khác trắng.
 *
 * Lỗi 4.19 làm mọi PDF hỏng ở bản đóng gói trong khi DOCX vẫn tốt — đếm pixel là
 * cách duy nhất phân biệt "canvas đã vẽ" với "canvas trắng đúng kích thước".
 */
const measurePdfCanvas = `
  (() => {
    const canvas = document.querySelector('[data-testid="pdf-page"] canvas');
    if (canvas === null) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;

    const { width, height } = canvas;
    if (width === 0 || height === 0) return { width, height, nonWhite: 0 };

    const { data } = context.getImageData(0, 0, width, height);
    let nonWhite = 0;
    // Lấy mẫu mỗi 4 pixel: 864×1296 là hơn 1.1 triệu pixel, đếm hết thì chậm mà
    // kết luận không đổi.
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonWhite += 1;
    }
    return { width, height, nonWhite };
  })()
`;

/* ------------------------------------------------------------------ luồng chính */

const run = async (cdp) => {
  const version = await cdp.evaluate(`
    ({
      hasApi: typeof window.api === 'object' && window.api !== null,
      channels: typeof window.api === 'object' ? Object.keys(window.api).sort() : [],
    })
  `);

  log(`Renderer nạp xong. window.api: ${version.channels.join(', ')}`);
  check('preload expose window.api', version.hasApi === true, `${version.channels.length} nhóm`);

  // Sidecar: ở bản đóng gói đây là chỗ lỗi đường dẫn asar sẽ lộ ra (mục 4.29a).
  const sidecar = await waitFor(
    'sidecar lên ready',
    async () => {
      const result = await cdp.evaluate(`window.api.sidecar.getStatus()`);
      if (result?.ok !== true) return undefined;
      const state = result.data?.state;
      return state === 'ready' || state === 'failed' ? result.data : undefined;
    },
    READY_TIMEOUT_MS,
  );
  check(
    'sidecar lên trạng thái ready',
    sidecar.state === 'ready',
    `state=${sidecar.state}${sidecar.port === undefined ? '' : ` port=${sidecar.port}`}`,
  );

  // Catalog voice đọc từ `resources/voices/` ở bản đóng gói — đường dẫn khác dev.
  const catalog = await cdp.evaluate(`window.api.voices.listCatalog()`);
  check(
    'đọc được catalog voice',
    catalog?.ok === true && Array.isArray(catalog.data) && catalog.data.length > 0,
    catalog?.ok === true ? `${catalog.data.length} voice` : JSON.stringify(catalog),
  );

  // Thư viện: cần ít nhất một sách để đi tiếp phần reader/storage.
  const books = await cdp.evaluate(`window.api.library.list()`);
  const bookCount = books?.ok === true ? books.data.length : 0;
  check('đọc được thư viện', books?.ok === true, `${bookCount} sách`);

  const colorsDark = await checkColors(cdp, 'dark');
  await cdp.screenshot(packaged ? 'packaged-library-dark' : 'dev-library-dark');

  const colorsLight = await checkColors(cdp, 'light');
  await cdp.screenshot(packaged ? 'packaged-library-light' : 'dev-library-light');

  check(
    'hai theme cho màu khác nhau',
    colorsDark.accent !== colorsLight.accent,
    `dark ${colorsDark.accent} vs light ${colorsLight.accent}`,
  );

  // Về dark để ảnh chụp phần sau nhất quán với các lần đo trước trong PROGRESS.
  await cdp.evaluate(clickThemeUntil('dark'));

  if (bookCount === 0) {
    log('Không có sách nào trong thư viện — bỏ qua phần reader/storage.');
    log('Nhập một sách rồi chạy lại để kiểm trọn luồng.');
    return;
  }

  /* --- Màn dung lượng ------------------------------------------------- */

  const openedStorage = await cdp.evaluate(clickTestId('open-storage'));
  if (openedStorage === true) {
    const usage = await waitFor('màn dung lượng nạp xong', async () =>
      cdp.evaluate(`
        (() => {
          const total = document.querySelector('[data-testid="storage-total"]');
          const bar = document.querySelector('[data-testid="storage-bar"]');
          if (total === null) return undefined;
          return {
            text: total.textContent,
            barHeight: bar === null ? 0 : bar.clientHeight,
            barFill: bar === null ? null : getComputedStyle(bar).backgroundColor,
          };
        })()
      `),
    );
    log('Màn dung lượng:');
    check('hiện tổng dung lượng', typeof usage.text === 'string' && usage.text !== '', usage.text);
    check('thanh dung lượng có chiều cao thật', usage.barHeight > 0, `${usage.barHeight} px`);
    await cdp.screenshot(packaged ? 'packaged-storage-dark' : 'dev-storage-dark');
  } else {
    fail('mở màn dung lượng', 'không thấy nút [data-testid="open-storage"]');
  }

  /* --- Trình đọc: bố cục + canvas ------------------------------------- */

  // Về thư viện rồi mở sách đầu tiên.
  //
  // Bấm theo `data-testid`, không theo chữ trên nút: nhãn thật là "← Quay lại"
  // chứ không phải "Thư viện" — dò bằng chữ đã làm phép kiểm này đỏ giả một lượt.
  //
  // Và phải **bấm lại tới khi màn hình đổi thật**: `element.click()` luôn trả về
  // thành công ngay cả khi React chưa gắn handler, nên một cú bấm duy nhất có thể
  // rơi vào khoảng trống đó và không có gì xảy ra. Đây cũng là một lượt chạy mất.
  await waitFor('về được màn thư viện', async () => {
    const onLibrary = await cdp.evaluate(
      `document.querySelector('[data-testid="book-card"]') !== null`,
    );
    if (onLibrary === true) return true;
    await cdp.evaluate(clickTestId('storage-back'));
    return undefined;
  });

  const opened = await cdp.evaluate(clickTestId('book-card'));
  if (opened !== true) {
    fail('mở sách từ thư viện', 'không thấy [data-testid="book-card"]');
    return;
  }

  // Vào đọc chương đầu. Bấm lại tới khi trình đọc hiện ra, cùng lý do như bước
  // trên: một cú bấm có thể rơi trước lúc React gắn handler.
  await waitFor('vào được trình đọc', async () => {
    const inReader = await cdp.evaluate(
      `document.querySelector('[data-testid="segment-panel"]') !== null`,
    );
    if (inReader === true) return true;
    await cdp.evaluate(clickTestId('chapter-item'));
    return undefined;
  });

  const layout = await checkSegmentLayout(cdp);
  await checkSegmentToggle(cdp, layout);
  await cdp.screenshot(packaged ? 'packaged-reader-dark' : 'dev-reader-dark');

  const canvas = await cdp.evaluate(measurePdfCanvas);
  if (canvas === null) {
    log('Sách đang mở không phải PDF — bỏ qua phép kiểm canvas.');
    const docx = await cdp.evaluate(`
      (() => {
        const content = document.querySelector('[data-testid="docx-content"]');
        if (content === null) return null;
        return { blocks: content.querySelectorAll('[data-block]').length, height: content.clientHeight };
      })()
    `);
    if (docx !== null) {
      log('Viewer DOCX:');
      check('render được khối DOCX', docx.blocks > 0, `${docx.blocks} khối`);
      check('nội dung có chiều cao thật', docx.height > 0, `${docx.height} px`);
    }
  } else {
    log('Viewer PDF:');
    check('canvas có kích thước thật', canvas.width > 0 && canvas.height > 0, `${canvas.width}×${canvas.height}`);
    check('canvas có pixel khác trắng (đã vẽ thật)', canvas.nonWhite > 1000, `${canvas.nonWhite} pixel mẫu`);
  }
};

/* ---------------------------------------------------------------- điều phối */

const child = launch();
let cdp;

try {
  const target = await findPageTarget();
  log(`Target: ${target.url}`);
  cdp = await connect(target.webSocketDebuggerUrl);
  await run(cdp);
} catch (error) {
  failures += 1;
  console.error(`[ui-check] LỖI: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  cdp?.close();

  if (!keepOpen) {
    // `child.kill()` chỉ giết tiến trình gốc. Bản dev còn Electron con, bản đóng
    // gói còn `ln-sidecar.exe` — dùng taskkill theo cây để không để lại mồ côi.
    child.kill();
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(1000);
  }
}

if (failures > 0) {
  console.error(`\n[ui-check] ${failures} phép kiểm HỎNG`);
  process.exit(1);
}

log(`\nTất cả phép kiểm đạt. Ảnh chụp ở ${shotDir}`);
process.exit(0);
