export interface Platform {
  log(message: string): void;
  showError(message: string, ...actions: string[]): Promise<string | undefined>;
  withProgress<T>(title: string, task: (report: (message: string) => void) => Promise<T>): Promise<T>;
  getConfig<T>(section: string, key: string, defaultValue: T): T;
  openExternal(url: string): void;
}
