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
/**
 * Giết Electron còn sót từ lượt chạy trước.
 *
 * Ngắt script giữa chừng (Ctrl-C, hoặc công cụ gọi nó bị huỷ) thì khối `finally`
 * không chạy tới nơi, để lại vài `electron.exe` mồ côi. Chúng vẫn **giữ**
 * `better_sqlite3.node` đang nạp, nên lượt sau `copyFileSync` ném `EBUSY` —
 * thông báo lỗi nói về copy file, không hề gợi ý rằng nguyên nhân là tiến trình
 * còn sống. Đã mất một lượt để lần ra.
 *
 * Chỉ giết `electron.exe`: `node.exe` có thể là chính script này, là dev server,
 * hoặc là tiến trình khác của user.
 */
const killOrphanElectron = () => {
  const list = spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/NH'], {
    encoding: 'utf8',
  });
  if (!/electron\.exe/i.test(list.stdout ?? '')) return;

  log('Thấy electron.exe còn sót từ lượt trước — dọn trước khi tráo ABI');
  spawnSync('taskkill', ['/F', '/IM', 'electron.exe', '/T'], { stdio: 'ignore' });
  // Windows nhả handle không tức thì sau khi tiến trình chết
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' });
};

/**
 * Cổng Vite của bản dev. Trùng `apps/renderer/vite.config.ts` (`strictPort`).
 *
 * `strictPort: true` là **cố ý**: `dev.mjs` trỏ Electron vào đúng URL này, nên
 * Vite nhảy sang cổng khác thì cửa sổ mở ra trắng trơn. Vì thế trùng cổng phải
 * là lỗi cứng — nhưng lỗi đó cần nói rõ ai đang giữ cổng.
 */
const VITE_PORT = 5273;

/**
 * Giải phóng cổng Vite nếu còn dev server mồ côi.
 *
 * Cùng gốc với `killOrphanElectron`: `pnpm dev` bị ngắt để lại `node.exe` chạy
 * Vite, và lượt sau chết với `Port 5273 is already in use` — thông báo đúng
 * nhưng không nói tiến trình nào, mà `node.exe` thì có cả chục cái.
 *
 * **Chỉ giết đúng PID đang LISTENING trên cổng đó.** Không bao giờ
 * `taskkill /IM node.exe`: trong đó có thể là editor, terminal, hoặc chính
 * script này.
 */
const freeVitePort = () => {
  const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  const pids = new Set();

  for (const line of (netstat.stdout ?? '').split('\n')) {
    if (!line.includes(`:${String(VITE_PORT)}`) || !line.includes('LISTENING')) continue;
    const pid = line.trim().split(/\s+/).pop();
    if (pid !== undefined && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }

  if (pids.size === 0) return;

  log(`Cổng ${String(VITE_PORT)} đang bị giữ (PID ${[...pids].join(', ')}) — dọn dev server cũ`);
  for (const pid of pids) {
    spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { stdio: 'ignore' });
  }
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: 'ignore' });
};

const ensureElectronAbi = () => {
  killOrphanElectron();
  if (!packaged) freeVitePort();

  log('Tráo better-sqlite3 sang ABI của Electron');
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'sqlite-abi.mjs'), 'electron'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `Không tráo được ABI cho Electron (mã ${result.status}).\n` +
        '  Nếu lỗi là EBUSY: còn tiến trình đang giữ better_sqlite3.node.\n' +
        '  Kiểm bằng `tasklist | findstr electron` rồi `taskkill /F /IM electron.exe /T`.',
    );
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

    // variantAttr cho các class chỉ tồn tại dưới dạng **variant**.
    //
    // Tailwind sinh selector kèm luôn thuộc tính: class data-[active]:bg-x ra
    // rule ".data-\\[active\\]\\:bg-x[data-active]{…}" — cái [data-active] là MỘT
    // PHẦN của selector. Probe không mang thuộc tính đó thì không rule nào khớp,
    // và ta đo ra rgba(0,0,0,0) y hệt triệu chứng 4.23 dù màu hoàn toàn lành lặn.
    // Đây là **đỏ giả**, đã mất một lượt chạy vì nó.
    const read = (className, variantAttr) => {
      probe.className = className;
      if (variantAttr !== undefined) probe.setAttribute(variantAttr, '');
      const value = getComputedStyle(probe).backgroundColor;
      if (variantAttr !== undefined) probe.removeAttribute(variantAttr);
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
    const readColor = (className, variantAttr) => {
      probe.className = className;
      if (variantAttr !== undefined) probe.setAttribute(variantAttr, '');
      const value = getComputedStyle(probe).color;
      if (variantAttr !== undefined) probe.removeAttribute(variantAttr);
      return value;
    };

    const result = {
      accent: read('bg-accent'),
      accentAlpha10: read('bg-accent/10'),
      accentAlpha5: read('bg-accent/5'),
      danger: read('bg-danger'),
      bgElevated: read('bg-bg-elevated'),
      // P3.4: ba biến phụ đề từng lưu dạng hex — đúng hình thái lỗi 4.23. Đổi
      // sang kênh RGB rời ở P3.4 thì nhánh alpha mới ra màu thật; đo lại ở đây
      // để không ai lỡ tay đổi ngược.
      //
      // Cả hai class này trong SubtitlePane đều là **variant** data-[active]:
      // — phải viết đúng tên đầy đủ VÀ đặt thuộc tính, nếu không đo ra trong suốt
      // dù màu vẫn đúng. Xem ghi chú ở hàm read.
      subtitleCurrent: readColor('data-[active]:text-subtitle-current', 'data-active'),
      subtitleCurrentAlpha15: read('data-[active]:bg-subtitle-current/15', 'data-active'),
      subtitlePast: readColor('text-subtitle-past'),
      // Hai token chữ dùng ở gần như mọi màn (P5.5c thêm vào đây). Trước đó
      // chúng chưa từng được đo ở **cả hai** theme: các phép kiểm màu chữ khác
      // đều chạy trên màn Cài đặt, mà script cố tình về dark trước khi vào đó.
      // Mất biến --fg ở một theme là mất chữ toàn app, không riêng ô nào.
      // (Không viết tên biến trong dấu backtick: cả khối này là template literal.)
      fg: readColor('text-fg'),
      fgMuted: readColor('text-fg-muted'),
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
    const header = document.querySelector('[data-testid="reader-subtitle"]');
    return {
      scrollHeight: scroll.clientHeight,
      panelHeight: panel.clientHeight,
      rows: document.querySelectorAll('[data-testid="segment-row"]').length,
      scrollable: scroll.scrollHeight,
      // Tổng số đoạn của chương, lấy từ nhãn "… · N đoạn" ở thanh đầu. Không có
      // thì trả 0 và phép kiểm tự lùi về chỉ dựa vào scrollHeight.
      total: Number(/(\\d+)\\s*đoạn/.exec(header?.textContent ?? '')?.[1] ?? 0),
    };
  })()
`;

/**
 * Số dòng render có khớp khung nhìn không.
 *
 * **Không so thẳng `rows >= floor(khung / 64)`.** Công thức đó ngầm giả định
 * chương luôn dài hơn khung, và nó đã đỏ giả một lượt trên chương "Bản quyền"
 * chỉ có 5 đoạn: khung 664 px chứa được ~10 dòng, mà cả chương chỉ có 5 —
 * render đủ 5 là **đúng**, không phải lỗi.
 *
 * Mốc đúng là `min(sức chứa khung, số đoạn thật)`. Hai nguồn cho số đoạn thật,
 * theo thứ tự tin cậy:
 *
 * 1. `scrollHeight` của ô cuộn (chiều cao nội dung) — luôn có, kể cả khi nhãn
 *    thanh đầu đổi chữ.
 * 2. Nhãn "N đoạn" ở thanh đầu — kiểm chéo, phòng khi chính khối ảo hoá dựng
 *    sai `totalHeight` và làm hỏng luôn nguồn 1.
 *
 * Vẫn bắt được lỗi 4.43 nguyên vẹn: chương dài mà chỉ render 4 dòng thì cả hai
 * nguồn đều nói phải nhiều hơn.
 */
const checkRowCount = (label, measured) => {
  const capacity = Math.floor(measured.scrollHeight / 64);
  const byContent = Math.ceil(measured.scrollable / 64);
  const total = measured.total > 0 ? Math.min(measured.total, byContent) : byContent;
  const expected = Math.min(capacity, total);

  check(
    label,
    measured.rows >= expected,
    `${measured.rows} dòng, khung chứa được ~${capacity}, chương có ${total} đoạn → cần ≥ ${expected}`,
  );
};

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

  // Số dòng phải phủ kín khung — hoặc phủ hết chương nếu chương ngắn hơn khung.
  // Đây là số đã bắt được lỗi thật: 4 dòng trong khung 764 px.
  checkRowCount('số dòng khớp chiều cao khung', measured);

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
  checkRowCount('sau khi hiện lại vẫn đủ dòng', again);
};

/* ------------------------------------------------- phép kiểm phụ đề (P3.4) */

/**
 * Phụ đề + splitter — đo trong Chromium thật.
 *
 * Ba thứ vitest không thể kết luận, tất cả đều là chiều cao/tỉ lệ thật:
 *
 * - **Hai pane chia đúng tỉ lệ**: `flex-basis` phần trăm chỉ ra đúng số khi có
 *   layout thật. jsdom trả 0 cho cả hai nên mọi tỉ lệ đều "đúng" vô nghĩa —
 *   chính hình thái lỗi 4.43.
 * - **Splitter bắt được chuột**: thanh cao 6 px, vùng `::after` nới lên 9 px.
 *   Sai chỗ này thì UI trông vẫn đúng mà kéo không được.
 * - **Từ đang đọc đổi màu thật**: `data-active` chỉ là thuộc tính; nó có ra màu
 *   hay không phụ thuộc CSS thật (lỗi 4.23).
 */
const measureSubtitle = `
  (() => {
    const pane = document.querySelector('[data-testid="subtitle-pane"]');
    const splitter = document.querySelector('[data-testid="pane-splitter"]');
    if (pane === null || splitter === null) return null;

    const column = splitter.parentElement;
    const viewer = column?.querySelector('main');

    return {
      paneHeight: pane.clientHeight,
      viewerHeight: viewer?.clientHeight ?? 0,
      columnHeight: column?.clientHeight ?? 0,
      splitterHeight: splitter.getBoundingClientRect().height,
      empty: pane.getAttribute('data-empty') === 'true',
      words: pane.querySelectorAll('[data-word-index]').length,
      ratioNow: Number(splitter.getAttribute('aria-valuenow')),
    };
  })()
`;

const checkSubtitle = async (cdp) => {
  const measured = await waitFor(
    'phụ đề render',
    async () => {
      const value = await cdp.evaluate(measureSubtitle);
      return value !== null ? value : undefined;
    },
    30_000,
  );

  log('Bố cục phụ đề:');

  check('pane phụ đề có chiều cao thật', measured.paneHeight > 50, `${measured.paneHeight} px`);
  check('viewer có chiều cao thật', measured.viewerHeight > 50, `${measured.viewerHeight} px`);
  check(
    'thanh kéo có chiều cao thật',
    measured.splitterHeight >= 4,
    `${measured.splitterHeight.toFixed(1)} px`,
  );

  // Tỉ lệ đo được phải khớp `aria-valuenow` trong sai số ±8 điểm: hai pane còn
  // có viền và thanh kéo chen giữa nên không bao giờ khớp tuyệt đối.
  const total = measured.viewerHeight + measured.paneHeight;
  const actual = total > 0 ? (measured.viewerHeight / total) * 100 : 0;
  check(
    'hai pane chia đúng tỉ lệ đã đặt',
    Math.abs(actual - measured.ratioNow) < 8,
    `đo được ${actual.toFixed(0)}%, đặt ${measured.ratioNow}%`,
  );

  return measured;
};

/**
 * Kéo splitter bằng bàn phím rồi đo lại: tỉ lệ thật phải đổi theo.
 *
 * Dùng bàn phím chứ không giả lập chuỗi pointer event: `setPointerCapture` trong
 * CDP cần toạ độ thật và dễ đỏ giả. Bàn phím đi qua **đúng** đường `onDrag` +
 * `onCommit`, tức vẫn kiểm được thứ cần kiểm.
 */
const checkSplitterDrag = async (cdp, before) => {
  const moved = await cdp.evaluate(`
    (() => {
      const splitter = document.querySelector('[data-testid="pane-splitter"]');
      if (splitter === null) return false;
      splitter.focus();
      for (let i = 0; i < 5; i += 1) {
        splitter.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
        );
      }
      return true;
    })()
  `);

  if (moved !== true) {
    fail('kéo thanh splitter', 'không thấy thanh kéo');
    return;
  }

  await sleep(400);
  const after = await cdp.evaluate(measureSubtitle);

  check(
    'kéo thanh thì phụ đề CAO LÊN thật (không chỉ đổi thuộc tính)',
    after !== null && after.paneHeight > before.paneHeight,
    `${before.paneHeight} → ${after?.paneHeight} px`,
  );

  // Trả lại chỗ cũ để ảnh chụp và các phép kiểm sau nhìn như mặc định
  await cdp.evaluate(`
    (() => {
      const splitter = document.querySelector('[data-testid="pane-splitter"]');
      for (let i = 0; i < 5; i += 1) {
        splitter?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }
      return true;
    })()
  `);
  await sleep(300);
};

/**
 * Ẩn/hiện phụ đề: viewer phải lấy lại đúng chỗ, rồi trả lại khi bật.
 *
 * Cùng hình thái lỗi 4.43 với panel đoạn — dựng lại sau khi layout xong cho kết
 * quả khác lần đầu.
 */
const checkSubtitleToggle = async (cdp, first) => {
  const clickToggle = `
    (() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        /Ẩn phụ đề|Hiện phụ đề/.test(b.textContent ?? ''),
      );
      if (button === undefined) return false;
      button.click();
      return true;
    })()
  `;

  if ((await cdp.evaluate(clickToggle)) !== true) {
    fail('tìm nút ẩn/hiện phụ đề', 'không thấy nút nào có chữ "Ẩn phụ đề"');
    return;
  }

  await sleep(400);
  const hidden = await cdp.evaluate(`
    (() => {
      const column = document.querySelector('[data-testid="pane-splitter"]');
      const viewer = document.querySelector('main');
      return { splitterGone: column === null, viewerHeight: viewer?.clientHeight ?? 0 };
    })()
  `);

  check('ẩn phụ đề thì thanh kéo biến mất theo', hidden?.splitterGone === true, String(hidden?.splitterGone));
  check(
    'ẩn phụ đề thì viewer lấy hết chỗ',
    hidden !== null && hidden.viewerHeight > first.viewerHeight,
    `${first.viewerHeight} → ${hidden?.viewerHeight} px`,
  );

  await cdp.evaluate(clickToggle);
  await sleep(400);

  const again = await waitFor('phụ đề hiện lại', async () => {
    const value = await cdp.evaluate(measureSubtitle);
    return value !== null ? value : undefined;
  });

  check(
    'hiện lại cho đúng chiều cao như lần đầu',
    Math.abs(again.paneHeight - first.paneHeight) <= 2,
    `lần đầu ${first.paneHeight} px, sau khi hiện lại ${again.paneHeight} px`,
  );
};

/**
 * Panel phải ba tab: Đoạn / Dấu trang / Hàng đợi (P5.4).
 *
 * Ba thứ jsdom không kiểm được, và cả ba đều đã cắn dự án này ít nhất một lần:
 *
 * 1. **Chiều cao thật của từng tab.** Mỗi tab một khối `flex-1 min-h-0` riêng.
 *    Gộp chung một khối bọc rồi rẽ nhánh bên trong sẽ chèn thêm một lớp `div`
 *    giữa ô cuộn và khối co giãn — đúng lỗi 4.43, và vitest chỉ thấy chuỗi class.
 * 2. **Màu thanh tiến độ.** `bg-success` là token KHÔNG có trong
 *    `tailwind.config.js`; viết nhầm thì thanh trong suốt chứ không đỏ ở đâu cả
 *    (lỗi 4.23). Đo màu tính ra được là cách duy nhất bắt được.
 * 3. **Bảng hàng đợi có nạp thật không** — `queue:listPending` chưa từng được
 *    gọi từ UI trước P5.4.
 */
const checkPanelTabs = async (cdp) => {
  log('Panel phải (P5.4):');

  const clickTab = (id) => clickTestId(`panel-tab-${id}`);

  /* --- Tab Dấu trang --- */
  if ((await cdp.evaluate(clickTab('bookmarks'))) !== true) {
    fail('mở tab Dấu trang', 'không thấy [data-testid="panel-tab-bookmarks"]');
    return;
  }
  await sleep(400);

  const bookmarks = await cdp.evaluate(`
    (() => {
      const stats = document.querySelector('[data-testid="reading-stats"]');
      const readBar = document.querySelector('[data-testid="reading-progress-bar"]');
      const audioBar = document.querySelector('[data-testid="audio-progress-bar"]');
      const empty = document.querySelector('[data-testid="bookmark-empty"]');
      const list = document.querySelector('[data-testid="bookmark-list"]');
      const panel = stats?.parentElement ?? null;
      return {
        hasStats: stats !== null,
        // Khối bọc phải có chiều cao THẬT — đây là chỗ lỗi 4.43 hay nấp
        panelHeight: panel === null ? 0 : panel.clientHeight,
        readBarColor: readBar === null ? null : getComputedStyle(readBar).backgroundColor,
        audioBarColor: audioBar === null ? null : getComputedStyle(audioBar).backgroundColor,
        // Danh sách rỗng hay có mục đều hợp lệ; im lặng cả hai mới là hỏng
        hasContent: empty !== null || list !== null,
        segmentsGone: document.querySelector('[data-testid="segment-scroll"]') === null,
      };
    })()
  `);

  check('tab Dấu trang hiện khối thống kê', bookmarks.hasStats === true, String(bookmarks.hasStats));
  check(
    'khối dấu trang có chiều cao thật',
    bookmarks.panelHeight > 50,
    `${bookmarks.panelHeight} px`,
  );
  check(
    'danh sách dấu trang hiện gì đó (rỗng hoặc có mục)',
    bookmarks.hasContent === true,
    String(bookmarks.hasContent),
  );
  check(
    'đổi tab thì danh sách đoạn nhường chỗ',
    bookmarks.segmentsGone === true,
    String(bookmarks.segmentsGone),
  );
  // Hai thanh phải có màu THẬT. `bg-success` không tồn tại trong config nên nếu
  // ai đó quay lại dùng token đó, phép kiểm này là chỗ duy nhất thấy được.
  for (const [name, value] of [
    ['thanh tiến độ đọc', bookmarks.readBarColor],
    ['thanh tiến độ audio', bookmarks.audioBarColor],
  ]) {
    check(`${name} không trong suốt`, typeof value === 'string' && !isTransparent(value), value);
  }

  /* --- Tab Hàng đợi --- */
  if ((await cdp.evaluate(clickTab('queue'))) !== true) {
    fail('mở tab Hàng đợi', 'không thấy [data-testid="panel-tab-queue"]');
    return;
  }

  const queue = await waitFor('bảng hàng đợi nạp xong', async () =>
    cdp.evaluate(`
      (() => {
        const table = document.querySelector('[data-testid="queue-table"]');
        if (table === null) return undefined;
        const empty = document.querySelector('[data-testid="queue-table-empty"]');
        const rows = document.querySelectorAll('[data-testid="queue-job-row"]');
        // "Đang tải…" nghĩa là chưa nạp xong — chờ tiếp thay vì kết luận sớm
        if (empty === null && rows.length === 0) return undefined;
        return { height: table.clientHeight, empty: empty !== null, rows: rows.length };
      })()
    `),
  );

  check('bảng hàng đợi có chiều cao thật', queue.height > 30, `${queue.height} px`);
  check(
    'listPending trả lời được (rỗng hoặc có job)',
    queue.empty === true || queue.rows > 0,
    queue.empty ? 'hàng đợi rỗng' : `${queue.rows} job`,
  );

  /* --- Về lại tab Đoạn để phần sau đo đúng như trước --- */
  await cdp.evaluate(clickTab('segments'));
  await sleep(400);
  const back = await cdp.evaluate(
    `document.querySelector('[data-testid="segment-scroll"]') !== null`,
  );
  check('quay lại tab Đoạn được', back === true, String(back));
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

  /* --- Màn cài đặt (P5.3) --------------------------------------------- */

  const openedSettings = await cdp.evaluate(clickTestId('open-settings'));
  if (openedSettings === true) {
    const fontSetting = await waitFor('màn cài đặt nạp xong', async () =>
      cdp.evaluate(`
        (() => {
          const range = document.querySelector('[data-testid="subtitle-font-range"]');
          const preview = document.querySelector('[data-testid="subtitle-font-preview"]');
          if (range === null || preview === null) return undefined;
          return {
            value: Number(range.value),
            // Cỡ chữ TÍNH RA được, không phải thuộc tính style đã ghi: đây đúng
            // là loại lỗi vitest không thấy (jsdom không tính CSS thật).
            previewPx: parseFloat(getComputedStyle(preview).fontSize),
            previewColor: getComputedStyle(preview).color,
          };
        })()
      `),
    );

    log('Màn cài đặt:');
    check(
      'thanh cỡ chữ có giá trị thật',
      fontSetting.value >= 10 && fontSetting.value <= 48,
      `${fontSetting.value} px`,
    );
    // Preview phải khớp giá trị thanh trượt — lệch nghĩa là user nhìn thử một
    // đằng, phụ đề thật một nẻo.
    check(
      'xem thử khớp cỡ chữ đang chọn',
      Math.abs(fontSetting.previewPx - fontSetting.value) < 0.5,
      `thanh ${fontSetting.value} px vs xem thử ${fontSetting.previewPx} px`,
    );
    // Bài học 4.23: màu trong suốt lọt qua mọi test cấu trúc.
    check(
      'chữ xem thử không trong suốt',
      typeof fontSetting.previewColor === 'string' &&
        !fontSetting.previewColor.includes('rgba(0, 0, 0, 0)'),
      fontSetting.previewColor,
    );
    /* --- Ô cập nhật (P5.5c) ------------------------------------------- */

    const updatePanel = await cdp.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="settings-update"]');
        if (panel === null) return null;
        const title = document.querySelector('[data-testid="update-title"]');
        const auto = document.querySelector('[data-testid="update-auto-check"]');
        const action = document.querySelector('[data-testid="update-action"]');
        return {
          state: panel.getAttribute('data-update-state'),
          titleText: title === null ? '' : title.textContent.trim(),
          // Màu chữ tiêu đề: cùng bẫy 4.23 — ô dựng ra mà chữ trong suốt thì
          // mọi phép kiểm cấu trúc vẫn xanh còn user không đọc được gì.
          titleColor: title === null ? '' : getComputedStyle(title).color,
          hasAutoCheck: auto !== null,
          autoChecked: auto === null ? null : auto.checked,
          actionLabel: action === null ? null : action.textContent.trim(),
          actionState: action === null ? null : action.getAttribute('data-action'),
        };
      })()
    `);

    if (updatePanel === null) {
      fail('ô cập nhật có trong màn cài đặt', 'không thấy [data-testid="settings-update"]');
    } else {
      check('ô cập nhật có mặt', true, `trạng thái: ${updatePanel.state}`);
      check(
        'tiêu đề cập nhật không trong suốt',
        !updatePanel.titleColor.includes('rgba(0, 0, 0, 0)'),
        `${updatePanel.titleText} — ${updatePanel.titleColor}`,
      );
      // `autoCheckUpdates` có trong AppSettings từ P5.5b nhưng tới P5.5c mới có
      // chỗ bấm. Thiếu ô này là setting chết quay lại (PROGRESS 4.71).
      check(
        'ô tick tự kiểm tra bản mới có mặt',
        updatePanel.hasAutoCheck,
        `đang ${updatePanel.autoChecked === true ? 'bật' : 'tắt'}`,
      );
      // Bản dev KHÔNG có `app-update.yml` → phải ra `unsupported` và **không**
      // được có nút nào. Có nút ở đây nghĩa là `updateBlockReason` không chạy,
      // và bản portable sẽ mời user tải một bản cài không bao giờ áp được.
      if (!packaged) {
        check(
          'bản dev báo không tự cập nhật được',
          updatePanel.state === 'unsupported',
          `state=${updatePanel.state}`,
        );
        check(
          'bản dev không mời user bấm nút vô nghĩa',
          updatePanel.actionLabel === null,
          updatePanel.actionLabel ?? 'không có nút — đúng',
        );
      } else {
        // `win-unpacked` CÓ `app-update.yml` (electron-builder chép vào
        // `resources/`), nên bản này đi vào đúng nhánh của bản NSIS đã cài:
        // phải ra `idle` kèm nút bấm được, không phải `unsupported`.
        //
        // Nhánh `checking → available → tải → cài` vẫn **không** kiểm được ở
        // đây — nó cần một release thật trên GitHub (PROGRESS mục 8).
        check(
          'bản đóng gói không rơi vào nhánh "không tự cập nhật"',
          updatePanel.state !== 'unsupported',
          `state=${updatePanel.state}`,
        );
        check(
          'bản đóng gói có nút cập nhật bấm được',
          updatePanel.actionLabel !== null,
          `${updatePanel.actionState ?? '—'}: ${updatePanel.actionLabel ?? 'KHÔNG CÓ NÚT'}`,
        );
      }
    }

    await cdp.screenshot(packaged ? 'packaged-settings-dark' : 'dev-settings-dark');

    await waitFor('về được màn thư viện từ cài đặt', async () => {
      const onLibrary = await cdp.evaluate(
        `document.querySelector('[data-testid="book-card"]') !== null`,
      );
      if (onLibrary === true) return true;
      await cdp.evaluate(clickTestId('settings-back'));
      return undefined;
    });
  } else {
    fail('mở màn cài đặt', 'không thấy nút [data-testid="open-settings"]');
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

    // Nút "Xoá phần đã đọc" (P5.3, nợ từ P2.7): handler có từ lâu, chỗ bấm thì
    // mới. Chỉ kiểm nó **hiện ra và bấm được** — không bấm thật, vì đây là
    // đường xoá file không lấy lại được.
    const deleteRead = await cdp.evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid^="storage-delete-read-"]');
        if (btn === null) return null;
        return { width: btn.clientWidth, height: btn.clientHeight, text: btn.textContent };
      })()
    `);
    check(
      'có nút xoá audio phần đã đọc',
      deleteRead !== null && deleteRead.width > 0 && deleteRead.height > 0,
      deleteRead === null ? 'không thấy nút' : `${deleteRead.width}×${deleteRead.height} px`,
    );
    await cdp.screenshot(packaged ? 'packaged-storage-dark' : 'dev-storage-dark');
  } else {
    fail('mở màn dung lượng', 'không thấy nút [data-testid="open-storage"]');
  }

  /* --- Màn giọng đọc (P2.3 + đa engine P6.2) -------------------------- */

  await waitFor('về thư viện trước khi mở màn giọng đọc', async () => {
    const onLibrary = await cdp.evaluate(
      `document.querySelector('[data-testid="book-card"]') !== null`,
    );
    if (onLibrary === true) return true;
    await cdp.evaluate(clickTestId('storage-back'));
    return undefined;
  });
  await checkVoices(cdp);

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

  const subtitle = await checkSubtitle(cdp);
  await checkSplitterDrag(cdp, subtitle);
  await checkSubtitleToggle(cdp, subtitle);

  // Nút đánh dấu (P5.4). Chỉ kiểm nó **hiện ra và ở đúng trạng thái** — không
  // bấm lưu thật, vì đó là ghi vào DB của user.
  const bookmarkButton = await cdp.evaluate(`
    (() => {
      const btn = document.querySelector('[data-testid="bookmark-toggle"]');
      if (btn === null) return null;
      return {
        width: btn.clientWidth,
        height: btn.clientHeight,
        disabled: btn.disabled === true,
        color: getComputedStyle(btn).color,
      };
    })()
  `);
  check(
    'có nút đánh dấu ở thanh đầu trình đọc',
    bookmarkButton !== null && bookmarkButton.width > 0 && bookmarkButton.height > 0,
    bookmarkButton === null
      ? 'không thấy nút'
      : `${bookmarkButton.width}×${bookmarkButton.height} px, ${
          bookmarkButton.disabled ? 'chưa chọn đoạn' : 'bấm được'
        }`,
  );
  check(
    'chữ trên nút đánh dấu không trong suốt',
    bookmarkButton !== null && !isTransparent(bookmarkButton.color),
    bookmarkButton?.color ?? 'không có',
  );

  await checkPanelTabs(cdp);

  await cdp.screenshot(packaged ? 'packaged-reader-dark' : 'dev-reader-dark');

  // Chờ pdfjs vẽ xong, không đo ngay: `<canvas>` được gắn vào DOM với đúng kích
  // thước **trước** khi có nét mực nào, nên đo ngay là đọc trúng khung trắng.
  //
  // Trước P6.2 phép kiểm này đo thẳng và vẫn xanh — nhưng chỉ vì các bước phía
  // trên tình cờ đủ chậm. Thêm màn giọng đọc vào trước đó làm nó đỏ ngay, tức
  // nó **vốn đã đua**, chỉ chưa lộ. Đây đúng loại "xanh vì may" mà mục 4.74 nói.
  //
  // Bọc trong sentinel `{ value }`: `waitFor` coi `null` là "chưa xong" và
  // **ném** khi hết giờ, nên trả `null` trần cho sách DOCX sẽ treo 30 giây rồi
  // làm hỏng cả lượt chạy thay vì rẽ sang nhánh DOCX.
  const canvas = (
    await waitFor('canvas PDF vẽ xong', async () => {
      const measured = await cdp.evaluate(measurePdfCanvas);
      if (measured === null) return { value: null };
      return measured.nonWhite > 1000 ? { value: measured } : undefined;
    })
  ).value;
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

  await checkPlayer(cdp);
};

/**
 * Màn Giọng đọc (P2.3, mở rộng đa engine ở P6.2).
 *
 * **Vì sao phải đo ở đây.** Danh sách giọng nhảy từ 3 lên 17 mục ở P6.2, và
 * `<main>` bọc ngoài là flex container `overflow-hidden`. Thiếu `overflow-y-auto`
 * ở khối con thì nội dung bị **cắt cụt, không cuộn được** — user chỉ xem được
 * phần đầu danh sách. jsdom không tính layout nên vitest xanh hết; đây là đúng
 * loại lỗi mục 4.43 đã ghi, và nó đã xảy ra thật một lần ở P6.2.
 */
const checkVoices = async (cdp) => {
  // Vào từ **thư viện**, không từ thanh player: nút ở player chỉ hiện khi CHƯA
  // chọn giọng (`needsVoice`), nên trên máy đã chọn giọng thì nó không tồn tại
  // và phép kiểm đỏ giả — đã dính đúng bẫy này một lượt chạy.
  const opened = await cdp.evaluate(clickTestId('open-voices'));
  if (opened !== true) {
    fail('mở màn giọng đọc', 'không thấy [data-testid="open-voices"]');
    return;
  }

  const measured = await waitFor('màn giọng đọc nạp xong', async () =>
    cdp.evaluate(`
      (() => {
        const root = document.querySelector('[data-testid="voice-manager"]');
        if (root === null) return undefined;
        const rows = document.querySelectorAll('[data-testid="voice-row"]');
        if (rows.length === 0) return undefined;
        const style = getComputedStyle(root);
        const engines = {};
        rows.forEach((r) => {
          const e = r.getAttribute('data-engine') ?? 'không rõ';
          engines[e] = (engines[e] ?? 0) + 1;
        });
        return {
          rows: rows.length,
          engines,
          overflowY: style.overflowY,
          // Chiều cao nội dung so với chiều cao khung: > 1 nghĩa là có phần
          // nằm ngoài tầm nhìn, tức BẮT BUỘC phải cuộn được.
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
          note: document.querySelector('[data-testid="voice-engine-note"]') !== null,
        };
      })()
    `),
  );

  log('Màn giọng đọc:');
  check('hiện danh sách giọng', measured.rows > 0, `${measured.rows} giọng`);
  check(
    'có cả giọng piper lẫn vieneu',
    (measured.engines.piper ?? 0) > 0 && (measured.engines.vieneu ?? 0) > 0,
    JSON.stringify(measured.engines),
  );

  // Hai phép kiểm tách nhau có chủ ý: cái đầu bắt lỗi "quên khai overflow",
  // cái sau bắt lỗi "khai rồi nhưng khung không có chiều cao nên vẫn không cuộn".
  check(
    'khối danh sách cuộn được theo chiều dọc',
    measured.overflowY === 'auto' || measured.overflowY === 'scroll',
    `overflow-y: ${measured.overflowY}`,
  );
  const overflowing = measured.scrollHeight > measured.clientHeight;
  check(
    'nội dung dài hơn khung thì vẫn với tới được',
    !overflowing || measured.clientHeight > 0,
    `nội dung ${measured.scrollHeight} px / khung ${measured.clientHeight} px`,
  );

  check('ghi chú riêng của engine vieneu hiện ra', measured.note === true);

  // KHÔNG chụp ảnh màn này: danh sách 17 giọng cao ~2500 px, chụp nó ngốn đủ
  // lâu để pdfjs phía sau không kịp vẽ xong trong hạn chờ — đã làm phép kiểm
  // canvas đỏ một lượt. Mọi thứ cần khẳng định ở đây đều là con số đo được.

  await waitFor('về được thư viện từ màn giọng đọc', async () => {
    const back = await cdp.evaluate(
      `document.querySelector('[data-testid="book-card"]') !== null`,
    );
    if (back === true) return true;
    await cdp.evaluate(clickTestId('voices-back'));
    return undefined;
  });
};

/**
 * Player (P3.2) — đo trong Chromium thật.
 *
 * Bắt được hai loại thứ mà vitest không thể: **thẻ `<audio>` thật có tồn tại và
 * có `preservesPitch` không** (jsdom không cài đặt media element), và **màu của
 * thanh player ở cả hai theme** (jsdom không tính CSS thật — mục 4.23).
 *
 * Không kiểm "có nghe thấy tiếng không": CDP không đọc được đầu ra âm thanh.
 * Thứ gần nhất kiểm được là `<audio>` có `src` blob và `currentTime` có chạy —
 * làm được khi máy có audio đã generate.
 */
const checkPlayer = async (cdp) => {
  log('Player:');

  const bar = await cdp.evaluate(`
    (() => {
      const el = document.querySelector('[data-testid="player-bar"]');
      if (el === null) return null;
      const style = getComputedStyle(el);
      const toggle = el.querySelector('[data-testid="player-toggle"]');
      return {
        state: el.getAttribute('data-state'),
        height: el.clientHeight,
        bg: style.backgroundColor,
        borderTop: style.borderTopColor,
        toggleBg: toggle === null ? null : getComputedStyle(toggle).backgroundColor,
        rates: el.querySelectorAll('[data-testid^="player-rate-"]').length,
      };
    })()
  `);

  if (bar === null) {
    fail('thanh player hiện ra', 'không thấy [data-testid="player-bar"]');
    return;
  }

  check('thanh player có chiều cao thật', bar.height > 20, `${bar.height} px`);
  check('nền thanh player không trong suốt', !isTransparent(bar.bg), bar.bg);
  check('nút phát không trong suốt', !isTransparent(bar.toggleBg), bar.toggleBg);
  check('trạng thái ban đầu là idle', bar.state === 'idle', bar.state);

  // Icon SVG thay cho emoji ⏮ ▶ ⏭ của bản P3.2: emoji là *ký tự*, hình dạng do
  // font quyết định và không ăn theo màu chữ. jsdom không tính CSS nên chỉ chỗ
  // này mới đo được icon có thật sự hiện ra và có kích thước.
  const icons = await cdp.evaluate(`
    (() => {
      const ids = ['player-prev', 'player-toggle', 'player-next'];
      return ids.map((id) => {
        const btn = document.querySelector('[data-testid="' + id + '"]');
        const svg = btn === null ? null : btn.querySelector('svg');
        if (svg === null) return { id, ok: false };
        const box = svg.getBoundingClientRect();
        return {
          id,
          ok: true,
          w: Math.round(box.width),
          h: Math.round(box.height),
          // Màu icon lấy từ màu chữ của nút — thứ emoji không làm được
          color: getComputedStyle(svg).color,
          text: btn.textContent.trim(),
        };
      });
    })()
  `);

  const drawn = (icons ?? []).filter((i) => i.ok && i.w >= 10 && i.h >= 10);
  check('icon điều khiển vẽ ra hình thật', drawn.length === 3, `${drawn.length}/3 icon có kích thước`);
  check(
    'icon ăn theo màu chữ của nút',
    drawn.every((i) => !isTransparent(i.color)),
    drawn.map((i) => i.color).join(' · '),
  );
  check(
    'không còn emoji trong nút điều khiển',
    (icons ?? []).every((i) => i.text === ''),
    (icons ?? []).map((i) => JSON.stringify(i.text)).join(' '),
  );

  // Thanh tiến độ trong đoạn — `flex-1` nên phải rộng thật, và cao thật.
  // Đúng loại lỗi mà mục 4.43 đã gặp: jsdom cho `clientHeight` luôn bằng 0.
  const progress = await cdp.evaluate(`
    (() => {
      const track = document.querySelector('[data-testid="player-progress"]');
      const fill = document.querySelector('[data-testid="player-progress-fill"]');
      const clock = document.querySelector('[data-testid="player-clock"]');
      if (track === null || fill === null) return null;
      const box = track.getBoundingClientRect();
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        trackBg: getComputedStyle(track).backgroundColor,
        fillBg: getComputedStyle(fill).backgroundColor,
        clock: clock === null ? null : clock.textContent.trim(),
      };
    })()
  `);

  if (progress === null) {
    fail('thanh tiến độ trong đoạn hiện ra', 'không thấy [data-testid="player-progress"]');
  } else {
    check('thanh tiến độ có bề ngang thật', progress.w > 100, `${progress.w} px`);
    check('thanh tiến độ có chiều cao thật', progress.h >= 4, `${progress.h} px`);
    check('nền rãnh không trong suốt', !isTransparent(progress.trackBg), progress.trackBg);
    check('màu thanh chạy không trong suốt', !isTransparent(progress.fillBg), progress.fillBg);
    check('đồng hồ hiện đúng dạng m:ss', /^\d+:\d{2} \/ \d+:\d{2}$/.test(progress.clock ?? ''), progress.clock);
  }

  // Thẻ `<audio>` do `usePlayer` dựng bằng `document.createElement` — không nằm
  // trong cây React nên `querySelector` trên document mới thấy.
  const media = await cdp.evaluate(`
    (() => {
      // KHÔNG fallback sang \`new Audio()\`: thẻ tự tạo luôn cho kết quả đẹp, nên
      // fallback biến phép kiểm này thành luôn-xanh kể cả khi player không dựng
      // được thẻ nào. Không thấy thẻ thật thì phải đỏ.
      const el = document.querySelector('[data-testid="player-audio"]');
      if (el === null) return null;
      // preservesPitch giữ lời hứa "đổi tốc độ KHÔNG regenerate audio".
      // Trình duyệt không hỗ trợ thì gán vào cũng không giữ lại.
      el.playbackRate = 1.5;
      el.preservesPitch = true;
      return { supportsPitch: el.preservesPitch === true, rate: el.playbackRate };
    })()
  `);

  if (media === null) {
    fail('player dựng được thẻ <audio> thật', 'không thấy [data-testid="player-audio"]');
  } else {
    check('Chromium giữ preservesPitch', media.supportsPitch === true, String(media.supportsPitch));
    check('playbackRate đặt được', media.rate === 1.5, String(media.rate));
  }

  // Menu tốc độ: mốc chỉ tồn tại sau khi mở menu (P3.3 đổi từ 6 nút bày ngang
  // sang menu thả xuống — 8 mốc bày ngang thì thanh player chật).
  await cdp.evaluate(clickTestId('player-rate-menu'));
  const menu = await cdp.evaluate(`
    (() => {
      const list = document.querySelector('[data-testid="player-rate-list"]');
      if (list === null) return null;
      const box = list.getBoundingClientRect();
      const bar = document.querySelector('[data-testid="player-bar"]').getBoundingClientRect();
      const steps = [...list.querySelectorAll('[data-testid^="player-rate-"]')];
      return {
        count: steps.length,
        labels: steps.map((s) => s.textContent.trim()),
        bg: getComputedStyle(list).backgroundColor,
        // Thanh player nằm sát đáy cửa sổ → menu PHẢI mở lên, nếu không nó nằm
        // ngoài màn hình. jsdom không tính layout nên chỉ đo được ở đây.
        opensUpward: box.top < bar.top,
        insideViewport: box.top >= 0 && box.bottom <= window.innerHeight,
      };
    })()
  `);

  if (menu === null) {
    fail('mở được menu tốc độ', 'không thấy [data-testid="player-rate-list"]');
  } else {
    check('menu tốc độ có đủ 8 mốc', menu.count === 8, `${menu.count} mốc`);
    check(
      'có mốc nhanh 2.5× và 3×',
      menu.labels.some((l) => l.includes('2.5')) && menu.labels.some((l) => l.includes('3×')),
      menu.labels.join(' '),
    );
    check('nền menu không trong suốt', !isTransparent(menu.bg), menu.bg);
    check('menu mở LÊN, không bị đáy cửa sổ cắt', menu.opensUpward === true, String(menu.opensUpward));
    check('menu nằm trọn trong màn hình', menu.insideViewport === true, String(menu.insideViewport));
  }

  // Bấm một mốc thật rồi đo lại — đường này đi qua store, sink, và thẻ audio
  // thật, tức đúng chuỗi mà user bấm. Chọn 3× để kiểm luôn mốc mới của P3.3.
  await cdp.evaluate(clickTestId('player-rate-3'));
  const afterRate = await cdp.evaluate(`
    (() => {
      const btn = document.querySelector('[data-testid="player-rate-menu"]');
      const audio = document.querySelector('[data-testid="player-audio"]');
      return {
        label: btn === null ? null : btn.textContent.trim(),
        closed: document.querySelector('[data-testid="player-rate-list"]') === null,
        // Giá trị đã tới thẻ audio thật chưa — mắt xích cuối của chuỗi
        audioRate: audio === null ? null : audio.playbackRate,
        pitch: audio === null ? null : audio.preservesPitch,
      };
    })()
  `);

  check('bấm mốc thì nút hiện đúng tốc độ vừa chọn', afterRate?.label?.includes('3×') === true, afterRate?.label);
  check('chọn xong thì menu đóng lại', afterRate?.closed === true, String(afterRate?.closed));
  check('tốc độ 3× tới được thẻ audio thật', afterRate?.audioRate === 3, String(afterRate?.audioRate));
  check('preservesPitch vẫn bật ở 3×', afterRate?.pitch === true, String(afterRate?.pitch));

  // Phím tắt: gửi sự kiện bàn phím thật vào `window` như Chromium sinh ra.
  // Kiểm hai chiều — phím phải ăn ở ngoài, và phải NHƯỜNG khi user đang gõ.
  const shortcut = await cdp.evaluate(`
    (async () => {
      const press = (key, target) =>
        (target ?? window).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );

      const rateOf = () =>
        document.querySelector('[data-testid="player-rate-menu"]').textContent.trim();

      // \`setRate\` là async và React phải render lại thì nhãn nút mới đổi. Đọc
      // ngay sau khi bấm phím là đọc nhãn cũ → đỏ giả.
      const settle = () => new Promise((r) => setTimeout(r, 120));

      const before = rateOf();
      press('[');
      await settle();
      const afterBracket = rateOf();

      // Ô nhập tạm để kiểm việc nhường phím — user gõ trong ô tìm kiếm hoặc ô
      // đổi tên chương thì KHÔNG được đổi tốc độ / tạm dừng nhạc.
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const rateBeforeTyping = rateOf();
      press('[', input);
      await settle();
      const rateAfterTyping = rateOf();
      input.remove();

      return {
        changedOutside: before !== afterBracket,
        before,
        after: afterBracket,
        ignoredWhileTyping: rateBeforeTyping === rateAfterTyping,
      };
    })()
  `);

  check(
    'phím [ đổi tốc độ khi đang đọc',
    shortcut?.changedOutside === true,
    `${shortcut?.before} → ${shortcut?.after}`,
  );
  check(
    'phím tắt NHƯỜNG khi user đang gõ trong ô nhập',
    shortcut?.ignoredWhileTyping === true,
    String(shortcut?.ignoredWhileTyping),
  );
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
