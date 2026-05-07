interface VsCodeApi {
  postMessage(message: any): void;
  getState<T = any>(): T | undefined;
  setState<T>(state: T): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
