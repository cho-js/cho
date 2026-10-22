export interface Adapter {
  createMessageHandler(): Promise<any>;

  createEventHandler(): Promise<any>;
}
