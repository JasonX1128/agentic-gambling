declare module "weave" {
  export function init(project: string): Promise<unknown>;
  export function op<T extends (...args: any[]) => any>(fn: T, options?: { name?: string }): T;
}
