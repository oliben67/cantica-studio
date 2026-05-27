import type { CanticaNamespace, CanticaPrompt } from './types/index.js';

export class CanticaClient {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  async fetchNamespaces(): Promise<CanticaNamespace[]> {
    const url = `${this.baseUrl}/v1/namespaces`;
    const response = await fetch(url, { headers: this.buildHeaders() });
    if (!response.ok) {
      throw new Error(
        `Cantica server error fetching namespaces: ${response.status} ${response.statusText}`,
      );
    }
    return response.json() as Promise<CanticaNamespace[]>;
  }

  async fetchPrompts(): Promise<CanticaPrompt[]> {
    const url = `${this.baseUrl}/v1/prompts`;
    const response = await fetch(url, { headers: this.buildHeaders() });
    if (!response.ok) {
      throw new Error(
        `Cantica server error fetching prompts: ${response.status} ${response.statusText}`,
      );
    }
    return response.json() as Promise<CanticaPrompt[]>;
  }

  /** Health-check: resolves to true if the server is reachable. */
  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
