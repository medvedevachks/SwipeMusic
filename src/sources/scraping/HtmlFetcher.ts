/**
 * Получение HTML независимо от транспорта.
 * Browser → сайт  или  Browser → Backend → сайт.
 * Парсер ScraperMusicAdapter не знает, кто скачал HTML.
 */
export type HtmlFetchOptions = {
  signal?: AbortSignal
  headers?: Record<string, string>
}

export interface HtmlFetcher {
  fetchHtml(url: string, options?: HtmlFetchOptions): Promise<string>
}

/**
 * Прямой браузерный fetch (часто упрётся в CORS — для продакшена нужен backend).
 * Архитектурная заготовка, без реальных запросов к музыкальным сайтам.
 */
export class BrowserHtmlFetcher implements HtmlFetcher {
  async fetchHtml(_url: string, _options?: HtmlFetchOptions): Promise<string> {
    throw new Error(
      'BrowserHtmlFetcher: live HTML fetch is disabled in this architecture stage',
    )
  }
}

/**
 * Заготовка прокси через backend (решает CORS).
 * Browser → Backend → HTML → Parser.
 */
export class BackendProxyHtmlFetcher implements HtmlFetcher {
  private readonly proxyEndpoint: string

  constructor(proxyEndpoint: string) {
    this.proxyEndpoint = proxyEndpoint
  }

  async fetchHtml(_url: string, _options?: HtmlFetchOptions): Promise<string> {
    void this.proxyEndpoint
    throw new Error(
      'BackendProxyHtmlFetcher: backend HTML proxy is not implemented yet',
    )
  }
}

/** @deprecated Используйте BackendProxyHtmlFetcher. */
export class BackendHtmlFetcher extends BackendProxyHtmlFetcher {}
