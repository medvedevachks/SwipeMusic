/**
 * DEV browser acceptance for NAV-CATALOG-01 via Chrome CDP (:9666).
 * Not part of npm test — manual / agent verification only.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Check = { name: string; ok: boolean; detail: string | null }

async function main() {
  const res = await fetch('http://127.0.0.1:9666/json/list')
  const targets = (await res.json()) as Array<{
    type: string
    url: string
    id: string
    webSocketDebuggerUrl?: string
  }>
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('No CDP page on :9666')
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('CDP websocket failed'))
  })

  let id = 0
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number
      result?: unknown
      error?: unknown
    }
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) {
        entry.reject(new Error(JSON.stringify(msg.error)))
      } else {
        entry.resolve(msg.result)
      }
    }
  }

  function send(method: string, params: Record<string, unknown> = {}) {
    const mid = ++id
    return new Promise<unknown>((resolve, reject) => {
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  }

  async function evalExpr(expression: string, awaitPromise = false) {
    const r = (await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })) as {
      result?: { value?: unknown }
      exceptionDetails?: unknown
    }
    if (r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails))
    }
    return r.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')

  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok: !!ok, detail: detail ?? null })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
  }

  // Чистый вход: сброс shuffle leftover с прошлой сессии через reload маршрута.
  await send('Page.navigate', {
    url: 'http://127.0.0.1:5173/library/catalogs/cat_dev_a',
  })
  await sleep(2500)

  let state = (await evalExpr(`({
    href: location.href,
    play: !!document.querySelector('[aria-label="Слушать каталог"]'),
    title: document.querySelector('h1')?.textContent || '',
    trackPlayCount: document.querySelectorAll('button[aria-label^="Слушать «"]').length,
    shuffle: document.querySelector('[aria-label="Shuffle"]')?.getAttribute('aria-pressed') || null
  })`)) as {
    href: string
    play: boolean
    title: string
    trackPlayCount: number
    shuffle: string | null
  }
  // Выключить shuffle в mini, если остался ON.
  if (state.shuffle === 'true') {
    await evalExpr(`document.querySelector('[aria-label="Shuffle"]')?.click()`)
    await sleep(300)
  }
  check(
    'catalog page',
    state.href.includes('cat_dev_a') && state.play && state.title.includes('Acceptance A'),
    JSON.stringify(state),
  )

  await evalExpr(`document.querySelector('[aria-label="Слушать каталог"]')?.click()`)
  await sleep(2000)

  state = (await evalExpr(`({
    href: location.href,
    player: !!document.querySelector('[data-testid="fullscreen-player"]'),
    session: document.querySelector('[data-testid="fullscreen-player-session"]')?.textContent || '',
    catalogTitle: document.querySelector('[data-testid="fullscreen-player-catalog-title"]')?.textContent || '',
    list: !!document.querySelector('[data-testid="fullscreen-player-catalog-list"]'),
    trackTitle: document.querySelector('.fullscreen-player-meta h2')?.textContent || '',
    playing: !!document.querySelector('[aria-label="Пауза"]'),
    audioCount: document.querySelectorAll('audio').length,
    queueRows: document.querySelectorAll('[data-testid^="fullscreen-player-catalog-track-"]').length
  })`)) as typeof state & {
    player: boolean
    session: string
    catalogTitle: string
    list: boolean
    trackTitle: string
    playing: boolean
    audioCount: number
    queueRows: number
  }

  check(
    '1 fullscreen opens',
    state.player && state.href.includes('player=full'),
    state.href,
  )
  check(
    '2 first track / catalog title',
    state.session.includes('Каталог') &&
      state.catalogTitle.includes('Acceptance A') &&
      state.queueRows === 3 &&
      Boolean(state.trackTitle),
    JSON.stringify({
      session: state.session,
      catalogTitle: state.catalogTitle,
      track: state.trackTitle,
      rows: state.queueRows,
      playing: state.playing,
    }),
  )
  check('13 single audio', state.audioCount <= 1, String(state.audioCount))

  // Линейный Next/Previous: shuffle OFF и старт с первого трека списка.
  for (let i = 0; i < 2; i += 1) {
    const pressed = await evalExpr(
      `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Shuffle"]')?.getAttribute('aria-pressed')`,
    )
    if (pressed !== 'true') {
      break
    }
    await evalExpr(
      `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Shuffle"]')?.click()`,
    )
    await sleep(200)
  }
  await evalExpr(`{
    const rows = [...document.querySelectorAll('[data-testid^="fullscreen-player-catalog-track-"]')];
    rows[0]?.click();
  }`)
  // Ждём, пока транспорт снова станет активным после switch.
  for (let i = 0; i < 20; i += 1) {
    const ready = await evalExpr(
      `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Следующий"]')?.disabled === false`,
    )
    if (ready) {
      break
    }
    await sleep(250)
  }
  const firstTitle = (await evalExpr(
    `document.querySelector('.fullscreen-player-meta h2')?.textContent || ''`,
  )) as string

  await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Следующий"]')?.click()`,
  )
  for (let i = 0; i < 20; i += 1) {
    const moved = await evalExpr(`({
      title: document.querySelector('.fullscreen-player-meta h2')?.textContent || '',
      idx: [...document.querySelectorAll('.fullscreen-player-catalog-row')].findIndex((r) =>
        r.classList.contains('is-current'),
      ),
      nextDisabled: document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Следующий"]')?.disabled === true
    })`)
    const m = moved as { title: string; idx: number; nextDisabled: boolean }
    if (m.idx === 1 && m.title && m.title !== firstTitle && !m.nextDisabled) {
      state = { ...state, trackTitle: m.title, idx: m.idx }
      break
    }
    await sleep(250)
  }
  check(
    '3 next track',
    state.idx === 1 && Boolean(state.trackTitle) && state.trackTitle !== firstTitle,
    JSON.stringify({ trackTitle: state.trackTitle, idx: state.idx, firstTitle }),
  )
  const secondTitle = state.trackTitle

  await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Предыдущий"]')?.click()`,
  )
  for (let i = 0; i < 20; i += 1) {
    const moved = await evalExpr(`({
      title: document.querySelector('.fullscreen-player-meta h2')?.textContent || '',
      idx: [...document.querySelectorAll('.fullscreen-player-catalog-row')].findIndex((r) =>
        r.classList.contains('is-current'),
      )
    })`)
    const m = moved as { title: string; idx: number }
    if (m.idx === 0 && m.title === firstTitle) {
      state = { ...state, trackTitle: m.title, idx: m.idx }
      break
    }
    await sleep(250)
  }
  check(
    '4 previous to first',
    state.idx === 0 && state.trackTitle === firstTitle && state.trackTitle !== secondTitle,
    JSON.stringify({ trackTitle: state.trackTitle, idx: state.idx, firstTitle, secondTitle }),
  )

  await evalExpr(`{
    const rows = [...document.querySelectorAll('[data-testid^="fullscreen-player-catalog-track-"]')];
    rows[2]?.click();
  }`)
  await sleep(1600)
  state = (await evalExpr(`({
    trackTitle: document.querySelector('.fullscreen-player-meta h2')?.textContent || '',
    idx: [...document.querySelectorAll('.fullscreen-player-catalog-row')].findIndex((r) =>
      r.classList.contains('is-current'),
    )
  })`)) as typeof state & { idx: number }
  check(
    '5 select third',
    state.idx === 2 && Boolean(state.trackTitle),
    JSON.stringify(state),
  )

  const shuffleBefore = await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Shuffle"]')?.getAttribute('aria-pressed')`,
  )
  await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Shuffle"]')?.click()`,
  )
  await sleep(200)
  const shuffleAfter = await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label="Shuffle"]')?.getAttribute('aria-pressed')`,
  )
  const repeatBefore = await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label^="Repeat"]')?.getAttribute('aria-label')`,
  )
  await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label^="Repeat"]')?.click()`,
  )
  await sleep(200)
  const repeatAfter = await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-transport"] button[aria-label^="Repeat"]')?.getAttribute('aria-label')`,
  )
  check(
    '7 shuffle/repeat',
    shuffleBefore !== shuffleAfter && repeatBefore !== repeatAfter,
    JSON.stringify({ shuffleBefore, shuffleAfter, repeatBefore, repeatAfter }),
  )

  await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-close"]')?.click()`,
  )
  await sleep(900)
  state = (await evalExpr(`({
    href: location.href,
    player: !!document.querySelector('[data-testid="fullscreen-player"]'),
    pageTitle: document.querySelector('h1')?.textContent || '',
    miniTitle: document.querySelector('[data-testid="mini-player-open-fullscreen"]')?.textContent || '',
    audioPlaying: (() => {
      const a = document.querySelector('audio');
      return !!(a && !a.paused);
    })()
  })`)) as typeof state & {
    pageTitle: string
    miniTitle: string
    audioPlaying: boolean
  }
  check(
    '8 close stays on catalog',
    !state.player &&
      state.href.includes('cat_dev_a') &&
      !state.href.includes('player=full') &&
      state.pageTitle.includes('Acceptance A'),
    JSON.stringify(state),
  )
  check(
    '9 music continues or mini shows catalog track',
    Boolean(state.miniTitle) || state.audioPlaying,
    JSON.stringify({ miniTitle: state.miniTitle, audioPlaying: state.audioPlaying }),
  )

  await evalExpr(
    "history.pushState({},'', '/search'); window.dispatchEvent(new PopStateEvent('popstate'));",
  )
  await sleep(700)
  const searchOk = await evalExpr(
    `location.pathname === '/search' && document.body.innerText.includes('Поиск')`,
  )
  await evalExpr(
    "history.pushState({},'', '/'); window.dispatchEvent(new PopStateEvent('popstate'));",
  )
  await sleep(900)
  const swipesOk = await evalExpr(
    `location.pathname === '/' && document.body.innerText.includes('Свайпы')`,
  )
  check('10 search/swipes routes', Boolean(searchOk) && Boolean(swipesOk), JSON.stringify({ searchOk, swipesOk }))

  await evalExpr(
    "history.pushState({},'', '/library'); window.dispatchEvent(new PopStateEvent('popstate'));",
  )
  await sleep(700)
  await evalExpr(`{
    const a = [...document.querySelectorAll('a')].find((x) => /Любимое/.test(x.textContent || ''));
    a?.click();
  }`)
  await sleep(1000)
  state = (await evalExpr(`({
    href: location.href,
    playDisabled: document.querySelector('[aria-label="Слушать каталог"]')?.disabled ?? null,
    player: !!document.querySelector('[data-testid="fullscreen-player"]')
  })`)) as typeof state & { playDisabled: boolean | null }
  check(
    '11 empty catalog no play',
    state.playDisabled === true && !state.player,
    JSON.stringify(state),
  )

  await send('Page.navigate', {
    url: 'http://127.0.0.1:5173/library/catalogs/cat_dev_a',
  })
  await sleep(2000)
  await evalExpr(`{
    const b = document.querySelector('[aria-label="Слушать каталог"]');
    b?.click();
    b?.click();
    b?.click();
  }`)
  await sleep(2500)
  state = (await evalExpr(`({
    player: !!document.querySelector('[data-testid="fullscreen-player"]'),
    audioCount: document.querySelectorAll('audio').length,
    href: location.href,
    rows: document.querySelectorAll('[data-testid^="fullscreen-player-catalog-track-"]').length,
    playError: document.querySelector('[role="alert"]')?.textContent || ''
  })`)) as typeof state & { rows: number; playError: string }
  check(
    '12 rapid play no dup audio',
    state.player && state.audioCount <= 1 && state.rows === 3 && state.href.includes('player=full'),
    JSON.stringify(state),
  )

  // Viewport smoke while fullscreen still open.
  for (const [w, h, label] of [
    [390, 844, '390x844'],
    [1024, 600, '1024x600'],
    [1280, 720, '1280x720'],
  ] as const) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: w < 800,
    })
    await sleep(350)
    const layout = (await evalExpr(`({
      transport: !!document.querySelector('[data-testid="fullscreen-player-transport"]'),
      list: !!document.querySelector('[data-testid="fullscreen-player-catalog-list"]'),
      transportTop: document.querySelector('[data-testid="fullscreen-player-transport"]')?.getBoundingClientRect().top ?? -1,
      vh: window.innerHeight
    })`)) as {
      transport: boolean
      list: boolean
      transportTop: number
      vh: number
    }
    check(
      `viewport ${label}`,
      layout.transport && layout.list && layout.transportTop >= 0 && layout.transportTop < layout.vh,
      JSON.stringify(layout),
    )
  }

  await send('Emulation.clearDeviceMetricsOverride')
  await evalExpr(
    `document.querySelector('[data-testid="fullscreen-player-close"]')?.click()`,
  )
  await sleep(1000)
  await evalExpr(`{
    const rowBtns = [...document.querySelectorAll('button[aria-label^="Слушать «"]')];
    rowBtns[1]?.click();
  }`)
  await sleep(2200)
  state = (await evalExpr(`({
    player: !!document.querySelector('[data-testid="fullscreen-player"]'),
    trackTitle: document.querySelector('.fullscreen-player-meta h2')?.textContent || '',
    idx: [...document.querySelectorAll('.fullscreen-player-catalog-row')].findIndex((r) =>
      r.classList.contains('is-current'),
    ),
    catalogTitle: document.querySelector('[data-testid="fullscreen-player-catalog-title"]')?.textContent || '',
    href: location.href
  })`)) as typeof state & { idx: number; catalogTitle: string }
  check(
    '6 play specific row',
    state.player && state.idx === 1 && state.catalogTitle.includes('Acceptance A'),
    JSON.stringify(state),
  )

  const failed = checks.filter((c) => !c.ok)
  console.log(
    'SUMMARY',
    JSON.stringify(
      {
        passed: checks.filter((c) => c.ok).length,
        failed: failed.length,
        fails: failed,
      },
      null,
      2,
    ),
  )
  ws.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
